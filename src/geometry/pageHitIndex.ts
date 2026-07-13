import type {
  BringsDocument,
  BringsError,
  Matrix,
  NodeId,
  Result,
  SceneNode,
} from '../document/types';
import {
  boundsIntersect,
  clipConvexPolygon,
  polygonBounds,
  rectanglePolygon,
  transformPolygon,
  type Bounds,
  type Polygon,
} from './intersection';
import type { PagePoint, PageRect } from './hit';
import {
  normalizedPageRectPolygon,
  normalizePageRect,
  prepareSelectionCandidate,
  preparedCandidateIntersects,
  type PreparedSelectionCandidate,
} from './hitShared';
import { MIN_MATRIX_DETERMINANT, multiplyMatrices } from './matrix';

/** An immutable exact-query index prepared for one document snapshot. */
export interface PageHitIndex {
  intersect(rect: PageRect): Result<readonly NodeId[]>;
  hitTest(point: PagePoint): readonly NodeId[];
}

type NodeEntry = Readonly<{ node: SceneNode; index: number }>;

type ClipChain = Readonly<{
  previous: ClipChain | null;
  polygon: Polygon;
  path: string;
  activationBounds: Bounds | null;
}>;

type CandidateEvent = Readonly<{
  kind: 'candidate';
  order: number;
  candidate: PreparedSelectionCandidate;
  chain: ClipChain | null;
  insertionBounds: Bounds | null;
}>;

type ClipEvent = Readonly<{
  kind: 'clip';
  order: number;
  incomingChain: ClipChain | null;
  ownChain: ClipChain;
  activationBounds: Bounds | null;
}>;

type ErrorEvent = Readonly<{
  kind: 'error';
  order: number;
  error: BringsError;
  chain: ClipChain | null;
  activationBounds: Bounds | null;
  terminal: boolean;
}>;

type PreparedEvent = CandidateEvent | ClipEvent | ErrorEvent;

type CellRange = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}>;

type PageHitIndexLimits = Readonly<{
  candidateCells: number;
  queryCells: number;
  buckets: number;
  references: number;
  globalEvents: number;
}>;

export type PageHitQueryMetrics = Readonly<{
  cellIterations: number;
  bucketReferencesRead: number;
  uniqueAabbChecks: number;
  narrowPhaseCalls: number;
  clipOperations: number;
  usedScanFallback: boolean;
}>;

type MutablePageHitQueryMetrics = {
  -readonly [Key in keyof PageHitQueryMetrics]: PageHitQueryMetrics[Key];
};

type PageHitIndexStats = Readonly<{
  mode: 'hash' | 'scan';
  bucketCount: number;
  referenceCount: number;
  globalEventCount: number;
  oversizedEventCount: number;
}>;

type PageHitBucket = number | readonly number[];
type PageHitBucketRow = ReadonlyMap<number, PageHitBucket>;
type PageHitBuckets = ReadonlyMap<number, PageHitBucketRow>;
type MutablePageHitBucket = number | number[];
type MutablePageHitBuckets = Map<number, Map<number, MutablePageHitBucket>>;

type PreparedPageHitIndex = Readonly<{
  events: readonly PreparedEvent[];
  mode: 'hash' | 'scan';
  buckets: PageHitBuckets;
  globalEventIndexes: readonly number[];
  oversizedEventIndexes: readonly number[];
  globalEventFlags: readonly boolean[];
  limits: PageHitIndexLimits;
  stats: PageHitIndexStats;
}>;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const GEOMETRY_EPSILON = 1e-9;
const PAGE_HIT_CELL_SIZE = 512;
const PAGE_HIT_MAX_CANDIDATE_CELLS = 64;
const PAGE_HIT_MAX_QUERY_CELLS = 4_096;
const PAGE_HIT_MAX_BUCKETS = 262_144;
const PAGE_HIT_MAX_REFERENCES = 1_000_000;
const PAGE_HIT_MAX_GLOBAL_EVENTS = 100_000;
const PAGE_HIT_INDEX_DATA = new WeakMap<PageHitIndex, PreparedPageHitIndex>();

export const DEFAULT_PAGE_HIT_INDEX_LIMITS: PageHitIndexLimits = Object.freeze({
  candidateCells: PAGE_HIT_MAX_CANDIDATE_CELLS,
  queryCells: PAGE_HIT_MAX_QUERY_CELLS,
  buckets: PAGE_HIT_MAX_BUCKETS,
  references: PAGE_HIT_MAX_REFERENCES,
  globalEvents: PAGE_HIT_MAX_GLOBAL_EVENTS,
});

function frozenError(code: string, path: string): BringsError {
  return Object.freeze({ code, path });
}

function success<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

function failureResult<T>(error: BringsError): Result<T> {
  return Object.freeze({
    ok: false,
    error: frozenError(error.code, error.path),
  });
}

function frozenEmptyIds(): readonly NodeId[] {
  return Object.freeze([]) as readonly NodeId[];
}

function freezeBounds(bounds: Bounds): Bounds {
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function freezePolygon(polygon: Polygon): Polygon {
  return Object.freeze(polygon.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

function nodeTransformPath(nodeIndex: number): string {
  return `/nodes/${nodeIndex}/transform`;
}

function haloBounds(bounds: Bounds): Bounds | null {
  const halo =
    GEOMETRY_EPSILON *
    Math.max(
      1,
      Math.abs(bounds.minX),
      Math.abs(bounds.minY),
      Math.abs(bounds.maxX),
      Math.abs(bounds.maxY),
    );
  const expanded = {
    minX: bounds.minX - halo,
    minY: bounds.minY - halo,
    maxX: bounds.maxX + halo,
    maxY: bounds.maxY + halo,
  };
  return Object.values(expanded).every(Number.isFinite) ? freezeBounds(expanded) : null;
}

function intersectBounds(left: Bounds, right: Bounds): Bounds | 'empty' {
  const value = {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY),
  };
  return value.minX <= value.maxX && value.minY <= value.maxY ? freezeBounds(value) : 'empty';
}

function candidateActivationBounds(
  candidate: PreparedSelectionCandidate,
  chain: ClipChain | null,
): Bounds | null {
  const candidateBounds = haloBounds(candidate.pageBounds);
  if (candidateBounds === null) return null;
  if (chain === null) return candidateBounds;
  if (chain.activationBounds === null) return null;
  const intersection = intersectBounds(candidateBounds, chain.activationBounds);
  return intersection === 'empty' ? null : intersection;
}

function extendClipChain(previous: ClipChain | null, polygon: Polygon, path: string): ClipChain {
  const polygonCopy = freezePolygon(polygon);
  const rawBounds = polygonBounds(polygonCopy);
  const ownBounds = rawBounds === null ? null : haloBounds(rawBounds);
  let activationBounds: Bounds | null = ownBounds;

  if (previous !== null) {
    if (previous.activationBounds === null || ownBounds === null) {
      activationBounds = null;
    } else {
      const intersection = intersectBounds(previous.activationBounds, ownBounds);
      activationBounds = intersection === 'empty' ? null : intersection;
    }
  }

  return Object.freeze({
    previous,
    polygon: polygonCopy,
    path,
    activationBounds,
  });
}

function eventActivationBounds(event: PreparedEvent): Bounds | null {
  return event.kind === 'candidate' ? event.insertionBounds : event.activationBounds;
}

function cellRange(bounds: Bounds): CellRange | null {
  const minX = Math.floor(bounds.minX / PAGE_HIT_CELL_SIZE);
  const minY = Math.floor(bounds.minY / PAGE_HIT_CELL_SIZE);
  const maxX = Math.floor(bounds.maxX / PAGE_HIT_CELL_SIZE);
  const maxY = Math.floor(bounds.maxY / PAGE_HIT_CELL_SIZE);
  if (![minX, minY, maxX, maxY].every(Number.isSafeInteger)) return null;

  const columns = maxX - minX + 1;
  const rows = maxY - minY + 1;
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    columns > Number.MAX_SAFE_INTEGER / rows
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY, count: columns * rows });
}

function isGlobalEvent(event: PreparedEvent): boolean {
  if (eventActivationBounds(event) === null) return true;
  if (event.kind === 'clip' && event.incomingChain === null) return true;
  return event.kind === 'error' && event.chain === null && event.terminal;
}

function validateLimits(limits: PageHitIndexLimits): PageHitIndexLimits {
  for (const key of [
    'candidateCells',
    'queryCells',
    'buckets',
    'references',
    'globalEvents',
  ] as const) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError('Page-hit index limits must be positive safe integers.');
    }
  }
  return Object.freeze({ ...limits });
}

function prepareSpatialIndex(
  events: readonly PreparedEvent[],
  requestedLimits: PageHitIndexLimits,
): PreparedPageHitIndex {
  const limits = validateLimits(requestedLimits);
  const buckets: MutablePageHitBuckets = new Map();
  const globalEventIndexes: number[] = [];
  const oversizedEventIndexes: number[] = [];
  const globalEventFlags: boolean[] = [];
  let hashActive = true;
  let bucketCount = 0;
  let referenceCount = 0;
  let globalEventCount = 0;
  let oversizedEventCount = 0;

  const switchToScan = (): void => {
    if (!hashActive) return;
    hashActive = false;
    buckets.clear();
    globalEventIndexes.length = 0;
    oversizedEventIndexes.length = 0;
    bucketCount = 0;
    referenceCount = 0;
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    const global = isGlobalEvent(event);
    globalEventFlags.push(global);

    if (global) {
      globalEventCount += 1;
      if (hashActive) {
        if (globalEventCount > limits.globalEvents) switchToScan();
        else globalEventIndexes.push(eventIndex);
      }
      continue;
    }

    const bounds = eventActivationBounds(event)!;
    const range = cellRange(bounds);
    if (range === null || range.count > limits.candidateCells) {
      oversizedEventCount += 1;
      if (hashActive) oversizedEventIndexes.push(eventIndex);
      continue;
    }
    if (!hashActive) continue;

    let newBucketCount = 0;
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const row = buckets.get(y);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        if (row?.has(x) !== true) newBucketCount += 1;
      }
    }
    if (
      bucketCount + newBucketCount > limits.buckets ||
      referenceCount + range.count > limits.references
    ) {
      switchToScan();
      continue;
    }
    for (let y = range.minY; y <= range.maxY; y += 1) {
      let row = buckets.get(y);
      if (row === undefined) {
        row = new Map();
        buckets.set(y, row);
      }
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const bucket = row.get(x);
        if (bucket === undefined) {
          row.set(x, eventIndex);
          bucketCount += 1;
        } else if (typeof bucket === 'number') {
          row.set(x, [bucket, eventIndex]);
        } else {
          bucket.push(eventIndex);
        }
      }
    }
    referenceCount += range.count;
  }

  if (hashActive) {
    for (const row of buckets.values()) {
      for (const bucket of row.values()) {
        if (Array.isArray(bucket)) Object.freeze(bucket);
      }
      Object.freeze(row);
    }
    Object.freeze(buckets);
  }
  const frozenBuckets: PageHitBuckets = buckets;
  const mode = hashActive ? 'hash' : 'scan';
  const stats: PageHitIndexStats = Object.freeze({
    mode,
    bucketCount: mode === 'hash' ? bucketCount : 0,
    referenceCount: mode === 'hash' ? referenceCount : 0,
    globalEventCount,
    oversizedEventCount,
  });
  return Object.freeze({
    events,
    mode,
    buckets: frozenBuckets,
    globalEventIndexes: Object.freeze(hashActive ? [...globalEventIndexes] : []),
    oversizedEventIndexes: Object.freeze(hashActive ? [...oversizedEventIndexes] : []),
    globalEventFlags: Object.freeze([...globalEventFlags]),
    limits,
    stats,
  });
}

function collectBucketEventIndexes(
  bucket: PageHitBucket | undefined,
  eventIndexes: Set<number>,
): number {
  if (bucket === undefined) return 0;
  if (typeof bucket === 'number') {
    eventIndexes.add(bucket);
    return 1;
  }
  for (const index of bucket) eventIndexes.add(index);
  return bucket.length;
}

function prepareEvents(document: BringsDocument): Result<readonly PreparedEvent[]> {
  const pageIndex = document.pages.findIndex((page) => page.id === document.activePageId);
  if (pageIndex < 0) {
    return failureResult(frozenError('geometry.active-page-not-found', '/activePageId'));
  }

  const nodes = new Map<string, NodeEntry>(
    document.nodes.map((node, index) => [node.id, { node, index }] as const),
  );
  const events: PreparedEvent[] = [];
  let order = 0;
  let terminal = false;

  const appendError = (error: BringsError, chain: ClipChain | null): boolean => {
    const isTerminal = chain === null;
    events.push(
      Object.freeze({
        kind: 'error',
        order,
        error: frozenError(error.code, error.path),
        chain,
        activationBounds: chain?.activationBounds ?? null,
        terminal: isTerminal,
      }),
    );
    order += 1;
    if (isTerminal) terminal = true;
    return isTerminal;
  };

  let immediateError: BringsError | null = null;
  const recordError = (error: BringsError, chain: ClipChain | null): boolean => {
    if (chain === null && events.length === 0) {
      immediateError = frozenError(error.code, error.path);
      terminal = true;
      return true;
    }
    return appendError(error, chain);
  };

  const visit = (
    node: SceneNode,
    nodeIndex: number,
    parentMatrix: Matrix,
    incomingChain: ClipChain | null,
  ): boolean => {
    if (terminal || !node.visible || node.locked) return terminal;

    const path = nodeTransformPath(nodeIndex);
    const pageMatrix = multiplyMatrices(parentMatrix, node.transform);
    if (pageMatrix.some((value) => !Number.isFinite(value))) {
      return recordError(frozenError('geometry.computation-overflow', path), incomingChain);
    }
    const determinant = pageMatrix[0] * pageMatrix[3] - pageMatrix[1] * pageMatrix[2];
    if (!Number.isFinite(determinant)) {
      return recordError(frozenError('geometry.computation-overflow', path), incomingChain);
    }
    if (Math.abs(determinant) < MIN_MATRIX_DETERMINANT) return false;

    const prepared = prepareSelectionCandidate(node, pageMatrix, nodeIndex);
    if (!prepared.ok) return recordError(prepared.error, incomingChain);
    if (prepared.value !== null) {
      const insertionBounds = candidateActivationBounds(prepared.value, incomingChain);
      events.push(
        Object.freeze({
          kind: 'candidate',
          order,
          candidate: prepared.value,
          chain: incomingChain,
          insertionBounds,
        }),
      );
      order += 1;
    }

    if (node.type !== 'frame' && node.type !== 'group') return false;

    let childChain = incomingChain;
    if (node.type === 'frame' && node.clipChildren) {
      const clip = transformPolygon(
        pageMatrix,
        rectanglePolygon(0, 0, node.width, node.height),
        path,
      );
      if (!clip.ok) return recordError(clip.error, incomingChain);

      childChain = extendClipChain(incomingChain, clip.value, path);
      events.push(
        Object.freeze({
          kind: 'clip',
          order,
          incomingChain,
          ownChain: childChain,
          activationBounds: incomingChain?.activationBounds ?? null,
        }),
      );
      order += 1;
    }

    for (let childIndex = 0; childIndex < node.childIds.length; childIndex += 1) {
      const childId = node.childIds[childIndex]!;
      const entry = nodes.get(childId);
      if (entry === undefined) {
        const shouldStop = recordError(
          frozenError('geometry.document-invariant', `/nodes/${nodeIndex}/childIds/${childIndex}`),
          incomingChain,
        );
        if (shouldStop) return true;
        continue;
      }
      if (entry.node.parentId !== node.id) {
        const shouldStop = recordError(
          frozenError('geometry.document-invariant', `/nodes/${entry.index}/parentId`),
          incomingChain,
        );
        if (shouldStop) return true;
        continue;
      }
      if (visit(entry.node, entry.index, pageMatrix, childChain)) {
        return true;
      }
    }
    return false;
  };

  const page = document.pages[pageIndex]!;
  for (let rootIndex = 0; rootIndex < page.rootNodeIds.length; rootIndex += 1) {
    const rootId = page.rootNodeIds[rootIndex]!;
    const root = nodes.get(rootId);
    if (root === undefined) {
      recordError(
        frozenError('geometry.document-invariant', `/pages/${pageIndex}/rootNodeIds/${rootIndex}`),
        null,
      );
      break;
    }
    if (root.node.parentId !== null) {
      recordError(
        frozenError('geometry.document-invariant', `/nodes/${root.index}/parentId`),
        null,
      );
      break;
    }
    if (visit(root.node, root.index, IDENTITY, null)) break;
  }

  if (immediateError !== null) return failureResult(immediateError);
  return success(Object.freeze([...events]));
}

function replayChain(
  chain: ClipChain,
  query: Polygon,
  memo: Map<ClipChain, Result<Polygon>>,
  metrics: MutablePageHitQueryMetrics,
): Result<Polygon> {
  const cached = memo.get(chain);
  if (cached !== undefined) return cached;

  const incoming =
    chain.previous === null ? success(query) : replayChain(chain.previous, query, memo, metrics);
  if (!incoming.ok) {
    memo.set(chain, incoming);
    return incoming;
  }
  if (incoming.value.length === 0) {
    const empty = success(Object.freeze([]) as Polygon);
    memo.set(chain, empty);
    return empty;
  }

  metrics.clipOperations += 1;
  const clipped = clipConvexPolygon(incoming.value, chain.polygon, chain.path);
  memo.set(chain, clipped);
  return clipped;
}

function replayIncomingChain(
  event: PreparedEvent,
  query: Polygon,
  memo: Map<ClipChain, Result<Polygon>>,
  metrics: MutablePageHitQueryMetrics,
): Result<Polygon> {
  const chain = event.kind === 'clip' ? event.incomingChain : event.chain;
  return chain === null ? success(query) : replayChain(chain, query, memo, metrics);
}

function queryEvents(
  prepared: PreparedPageHitIndex,
  rect: PageRect,
): Readonly<{ result: Result<readonly NodeId[]>; metrics: PageHitQueryMetrics }> {
  const mutableMetrics: MutablePageHitQueryMetrics = {
    cellIterations: 0,
    bucketReferencesRead: 0,
    uniqueAabbChecks: 0,
    narrowPhaseCalls: 0,
    clipOperations: 0,
    usedScanFallback: false,
  };
  const finish = (
    result: Result<readonly NodeId[]>,
  ): Readonly<{ result: Result<readonly NodeId[]>; metrics: PageHitQueryMetrics }> =>
    Object.freeze({ result, metrics: Object.freeze({ ...mutableMetrics }) });

  const normalized = normalizePageRect(rect);
  if (!normalized.ok) return finish(failureResult(normalized.error));
  const query = normalizedPageRectPolygon(normalized.value);
  const rawQueryBounds = polygonBounds(query);
  if (rawQueryBounds === null) return finish(success(frozenEmptyIds()));
  const queryBounds = haloBounds(rawQueryBounds);

  const eventIndexes = new Set<number>();
  const useMasterScan = (): void => {
    mutableMetrics.usedScanFallback = true;
    for (let index = 0; index < prepared.events.length; index += 1) eventIndexes.add(index);
  };

  if (prepared.mode === 'scan' || queryBounds === null) {
    useMasterScan();
  } else {
    const range = cellRange(queryBounds);
    if (range === null || range.count > prepared.limits.queryCells) {
      useMasterScan();
    } else {
      for (const index of prepared.globalEventIndexes) eventIndexes.add(index);
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          mutableMetrics.cellIterations += 1;
          mutableMetrics.bucketReferencesRead += collectBucketEventIndexes(
            prepared.buckets.get(y)?.get(x),
            eventIndexes,
          );
        }
      }
      for (const index of prepared.oversizedEventIndexes) eventIndexes.add(index);
    }
  }

  const orderedIndexes = [...eventIndexes].sort(
    (left, right) => prepared.events[left]!.order - prepared.events[right]!.order,
  );

  const hits: NodeId[] = [];
  const clipMemo = new Map<ClipChain, Result<Polygon>>();
  for (const eventIndex of orderedIndexes) {
    const event = prepared.events[eventIndex]!;
    const activationBounds = eventActivationBounds(event);
    if (!prepared.globalEventFlags[eventIndex] && activationBounds !== null) {
      mutableMetrics.uniqueAabbChecks += 1;
      if (queryBounds !== null && !boundsIntersect(activationBounds, queryBounds)) continue;
    }

    const reachable = replayIncomingChain(event, query, clipMemo, mutableMetrics);
    if (!reachable.ok) return finish(failureResult(reachable.error));
    if (reachable.value.length === 0) continue;

    if (event.kind === 'error') return finish(failureResult(event.error));
    if (event.kind === 'clip') {
      const clipped = replayChain(event.ownChain, query, clipMemo, mutableMetrics);
      if (!clipped.ok) return finish(failureResult(clipped.error));
      continue;
    }

    mutableMetrics.narrowPhaseCalls += 1;
    const hit = preparedCandidateIntersects(event.candidate, reachable.value);
    if (!hit.ok) return finish(failureResult(hit.error));
    if (hit.value) hits.push(event.candidate.id);
  }

  return finish(success(Object.freeze([...hits])));
}

function createPageHitIndexWithLimits(
  document: BringsDocument,
  limits: PageHitIndexLimits,
): Result<PageHitIndex> {
  const prepared = prepareEvents(document);
  if (!prepared.ok) return failureResult(prepared.error);
  const spatial = prepareSpatialIndex(prepared.value, limits);
  const index: PageHitIndex = {
    intersect(rect) {
      return queryEvents(spatial, rect).result;
    },
    hitTest(point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return frozenEmptyIds();
      const result = queryEvents(spatial, {
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      }).result;
      return result.ok ? Object.freeze([...result.value].reverse()) : frozenEmptyIds();
    },
  };
  const frozenIndex = Object.freeze(index);
  PAGE_HIT_INDEX_DATA.set(frozenIndex, spatial);
  return success(frozenIndex);
}

/** Prepare an immutable ordered exact-query index for one document snapshot. */
export function createPageHitIndex(document: BringsDocument): Result<PageHitIndex> {
  return createPageHitIndexWithLimits(document, DEFAULT_PAGE_HIT_INDEX_LIMITS);
}

/** Build the production index with explicit limits for deterministic source tests. */
export function createPageHitIndexForTesting(
  document: BringsDocument,
  limits: PageHitIndexLimits,
): Result<PageHitIndex> {
  return createPageHitIndexWithLimits(document, limits);
}

/** Inspect one indexed query without publishing diagnostics from the package root. */
export function inspectPageHitIndex(
  index: PageHitIndex,
  rect: PageRect,
): Readonly<{
  result: Result<readonly NodeId[]>;
  metrics: PageHitQueryMetrics;
  indexStats: PageHitIndexStats;
}> {
  const prepared = PAGE_HIT_INDEX_DATA.get(index);
  if (prepared === undefined)
    throw new TypeError('Expected a PageHitIndex created by this module.');
  const inspected = queryEvents(prepared, rect);
  return Object.freeze({
    result: inspected.result,
    metrics: inspected.metrics,
    indexStats: prepared.stats,
  });
}

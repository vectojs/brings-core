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

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const GEOMETRY_EPSILON = 1e-9;

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
): Result<Polygon> {
  const cached = memo.get(chain);
  if (cached !== undefined) return cached;

  const incoming =
    chain.previous === null ? success(query) : replayChain(chain.previous, query, memo);
  if (!incoming.ok) {
    memo.set(chain, incoming);
    return incoming;
  }
  if (incoming.value.length === 0) {
    const empty = success(Object.freeze([]) as Polygon);
    memo.set(chain, empty);
    return empty;
  }

  const clipped = clipConvexPolygon(incoming.value, chain.polygon, chain.path);
  memo.set(chain, clipped);
  return clipped;
}

function replayIncomingChain(
  event: PreparedEvent,
  query: Polygon,
  memo: Map<ClipChain, Result<Polygon>>,
): Result<Polygon> {
  const chain = event.kind === 'clip' ? event.incomingChain : event.chain;
  return chain === null ? success(query) : replayChain(chain, query, memo);
}

function queryEvents(events: readonly PreparedEvent[], rect: PageRect): Result<readonly NodeId[]> {
  const normalized = normalizePageRect(rect);
  if (!normalized.ok) return failureResult(normalized.error);
  const query = normalizedPageRectPolygon(normalized.value);
  const queryBounds = polygonBounds(query);
  if (queryBounds === null) return success(frozenEmptyIds());

  const hits: NodeId[] = [];
  const clipMemo = new Map<ClipChain, Result<Polygon>>();
  for (const event of events) {
    const activationBounds = eventActivationBounds(event);
    if (activationBounds !== null && !boundsIntersect(activationBounds, queryBounds)) continue;

    const reachable = replayIncomingChain(event, query, clipMemo);
    if (!reachable.ok) return failureResult(reachable.error);
    if (reachable.value.length === 0) continue;

    if (event.kind === 'error') return failureResult(event.error);
    if (event.kind === 'clip') {
      const clipped = replayChain(event.ownChain, query, clipMemo);
      if (!clipped.ok) return failureResult(clipped.error);
      continue;
    }

    const hit = preparedCandidateIntersects(event.candidate, reachable.value);
    if (!hit.ok) return failureResult(hit.error);
    if (hit.value) hits.push(event.candidate.id);
  }

  return success(Object.freeze([...hits]));
}

/** Prepare an immutable ordered exact-query index for one document snapshot. */
export function createPageHitIndex(document: BringsDocument): Result<PageHitIndex> {
  const prepared = prepareEvents(document);
  if (!prepared.ok) return failureResult(prepared.error);
  const events = prepared.value;
  const index: PageHitIndex = {
    intersect(rect) {
      return queryEvents(events, rect);
    },
    hitTest(point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return frozenEmptyIds();
      const result = queryEvents(events, { x: point.x, y: point.y, width: 0, height: 0 });
      return result.ok ? Object.freeze([...result.value].reverse()) : frozenEmptyIds();
    },
  };
  return success(Object.freeze(index));
}

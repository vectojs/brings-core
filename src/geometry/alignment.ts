import { resolveStructuralSelection } from '../document/selection';
import type {
  BringsDocument,
  Matrix,
  NodeId,
  Result,
  SceneNode,
  SelectionInput,
  StructuralSelection,
} from '../document/types';
import { polygonBounds, rectanglePolygon, transformPolygon } from './intersection';
import { multiplyMatrices, pageMatrixForNode } from './matrix';
import {
  prepareSelectionResize,
  type ResizeBounds,
  type ResizeHandle,
  type ResizePoint,
  type SelectionResizeProposal,
  type SelectionResizeProposalInput,
} from './resize';

/** Fixed document-space distance within which two alignment anchors snap. */
export const ALIGNMENT_SNAP_THRESHOLD = 6;

export type AlignmentAxis = 'x' | 'y';
export type AlignmentAnchor = 'min' | 'center' | 'max';

/** A renderer-independent page-space alignment relationship. */
export type AlignmentGuide = Readonly<{
  axis: AlignmentAxis;
  sourceAnchor: AlignmentAnchor;
  targetAnchor: AlignmentAnchor;
  targetNodeId: NodeId;
  coordinate: number;
  minExtent: number;
  maxExtent: number;
}>;

/** The exact delta and guide set for one immutable move preview. */
export type AlignmentMoveResult = Readonly<{
  delta: Readonly<{ x: number; y: number }>;
  guides: readonly AlignmentGuide[];
}>;

/** An exact resized proposal and the pointer sample that regenerates it. */
export type AlignmentResizeResult = Readonly<{
  currentPoint: ResizePoint;
  resize: SelectionResizeProposal;
  guides: readonly AlignmentGuide[];
}>;

/** Prepared immutable target capture for one normalized active-page selection. */
export type PreparedSelectionAlignment = Readonly<{
  selection: StructuralSelection;
  bounds: ResizeBounds;
  resolveMove(delta: Readonly<{ x: number; y: number }>): Result<AlignmentMoveResult>;
  resolveResize(input: SelectionResizeProposalInput): Result<AlignmentResizeResult>;
}>;

type Target = Readonly<{
  nodeId: NodeId;
  bounds: ResizeBounds;
  traversalOrder: number;
}>;

type Candidate = Readonly<{
  correction: number;
  guide: AlignmentGuide;
  traversalOrder: number;
  sourceOrder: number;
  targetOrder: number;
}>;

type ResizeCandidate = Candidate &
  Readonly<{
    currentPoint: ResizePoint;
  }>;

type ResizeAnchorResponse = Readonly<{
  anchor: AlignmentAnchor;
  response: number;
}>;

const ANCHORS: readonly AlignmentAnchor[] = Object.freeze(['min', 'center', 'max']);

const RESIZE_HANDLE_AXES: Readonly<
  Record<ResizeHandle, Readonly<{ x: -1 | 0 | 1; y: -1 | 0 | 1 }>>
> = Object.freeze({
  'north-west': Object.freeze({ x: -1, y: -1 }),
  north: Object.freeze({ x: 0, y: -1 }),
  'north-east': Object.freeze({ x: 1, y: -1 }),
  east: Object.freeze({ x: 1, y: 0 }),
  'south-east': Object.freeze({ x: 1, y: 1 }),
  south: Object.freeze({ x: 0, y: 1 }),
  'south-west': Object.freeze({ x: -1, y: 1 }),
  west: Object.freeze({ x: -1, y: 0 }),
});

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function freezeBounds(bounds: ResizeBounds): ResizeBounds {
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function freezeSelection(selection: StructuralSelection): StructuralSelection {
  return Object.freeze({
    nodeIds: Object.freeze([...selection.nodeIds]),
    activeNodeId: selection.activeNodeId,
  });
}

function unionBounds(left: ResizeBounds | null, right: ResizeBounds): ResizeBounds {
  if (left === null) return right;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function nodeModelBounds(
  document: BringsDocument,
  nodes: ReadonlyMap<string, SceneNode>,
  indices: ReadonlyMap<string, number>,
  node: SceneNode,
  inheritedPageMatrix?: Matrix,
): Result<ResizeBounds> {
  const index = indices.get(node.id) ?? 0;
  const path = `/nodes/${index}/transform`;
  const resolvedPageMatrix =
    inheritedPageMatrix === undefined
      ? pageMatrixForNode(document, node.id, path)
      : success(inheritedPageMatrix);
  if (!resolvedPageMatrix.ok) return resolvedPageMatrix;

  if (node.type === 'group') {
    let bounds: ResizeBounds | null = null;
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (child === undefined) {
        return failure('node.not-found', `/nodes/${indices.get(node.id) ?? 0}/childIds`);
      }
      const childBounds = nodeModelBounds(
        document,
        nodes,
        indices,
        child,
        multiplyMatrices(resolvedPageMatrix.value, child.transform),
      );
      if (!childBounds.ok) return childBounds;
      bounds = unionBounds(bounds, childBounds.value);
    }
    return bounds === null
      ? failure('resize.bounds-empty', `/nodes/${indices.get(node.id) ?? 0}/childIds`)
      : success(bounds);
  }

  const polygon = transformPolygon(
    resolvedPageMatrix.value,
    rectanglePolygon(0, 0, node.width, node.height),
    path,
  );
  if (!polygon.ok) return polygon;
  const bounds = polygonBounds(polygon.value);
  if (
    bounds === null ||
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return failure('geometry.computation-overflow', path);
  }
  return success(bounds);
}

function axisValue(bounds: ResizeBounds, axis: AlignmentAxis, anchor: AlignmentAnchor): number {
  const min = axis === 'x' ? bounds.minX : bounds.minY;
  const max = axis === 'x' ? bounds.maxX : bounds.maxY;
  return anchor === 'min' ? min : anchor === 'max' ? max : min + (max - min) / 2;
}

function translateBounds(
  bounds: ResizeBounds,
  delta: Readonly<{ x: number; y: number }>,
): ResizeBounds {
  return {
    minX: bounds.minX + delta.x,
    minY: bounds.minY + delta.y,
    maxX: bounds.maxX + delta.x,
    maxY: bounds.maxY + delta.y,
  };
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const correction = Math.abs(left.correction) - Math.abs(right.correction);
  if (correction !== 0) return correction;
  const traversal = left.traversalOrder - right.traversalOrder;
  if (traversal !== 0) return traversal;
  const source = left.sourceOrder - right.sourceOrder;
  if (source !== 0) return source;
  return left.targetOrder - right.targetOrder;
}

function candidateForAxis(
  axis: AlignmentAxis,
  source: ResizeBounds,
  targets: readonly Target[],
): Candidate | null {
  let best: Candidate | null = null;
  for (const target of targets) {
    for (let sourceOrder = 0; sourceOrder < ANCHORS.length; sourceOrder += 1) {
      const sourceAnchor = ANCHORS[sourceOrder]!;
      const sourceCoordinate = axisValue(source, axis, sourceAnchor);
      for (let targetOrder = 0; targetOrder < ANCHORS.length; targetOrder += 1) {
        const targetAnchor = ANCHORS[targetOrder]!;
        const coordinate = axisValue(target.bounds, axis, targetAnchor);
        const correction = coordinate - sourceCoordinate;
        if (!Number.isFinite(correction) || Math.abs(correction) > ALIGNMENT_SNAP_THRESHOLD) {
          continue;
        }
        const guide: AlignmentGuide = Object.freeze({
          axis,
          sourceAnchor,
          targetAnchor,
          targetNodeId: target.nodeId,
          coordinate,
          minExtent:
            axis === 'x'
              ? Math.min(source.minY, target.bounds.minY)
              : Math.min(source.minX, target.bounds.minX),
          maxExtent:
            axis === 'x'
              ? Math.max(source.maxY, target.bounds.maxY)
              : Math.max(source.maxX, target.bounds.maxX),
        });
        const candidate: Candidate = {
          correction,
          guide,
          traversalOrder: target.traversalOrder,
          sourceOrder,
          targetOrder,
        };
        if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
      }
    }
  }
  return best;
}

function finiteDelta(value: unknown): Result<Readonly<{ x: number; y: number }>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failure('geometry.point-invalid', '/delta');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.x !== 'number' || !Number.isFinite(record.x)) {
    return failure('geometry.point-invalid', '/delta/x');
  }
  if (typeof record.y !== 'number' || !Number.isFinite(record.y)) {
    return failure('geometry.point-invalid', '/delta/y');
  }
  return success({
    x: Object.is(record.x, -0) ? 0 : record.x,
    y: Object.is(record.y, -0) ? 0 : record.y,
  });
}

function freezeMoveResult(
  delta: Readonly<{ x: number; y: number }>,
  guides: readonly AlignmentGuide[],
): AlignmentMoveResult {
  return Object.freeze({
    delta: Object.freeze({ x: delta.x, y: delta.y }),
    guides: Object.freeze([...guides]),
  });
}

function freezeResizeResult(
  currentPoint: ResizePoint,
  resize: SelectionResizeProposal,
  guides: readonly AlignmentGuide[],
): AlignmentResizeResult {
  return Object.freeze({
    currentPoint: Object.freeze({ x: currentPoint.x, y: currentPoint.y }),
    resize,
    guides: Object.freeze([...guides]),
  });
}

function pointForResizeAxes(
  bounds: ResizeBounds,
  axes: Readonly<{ x: -1 | 0 | 1; y: -1 | 0 | 1 }>,
): ResizePoint {
  const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
  const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
  return {
    x: axes.x < 0 ? bounds.minX : axes.x > 0 ? bounds.maxX : centerX,
    y: axes.y < 0 ? bounds.minY : axes.y > 0 ? bounds.maxY : centerY,
  };
}

function resizeAnchor(
  bounds: ResizeBounds,
  axes: Readonly<{ x: -1 | 0 | 1; y: -1 | 0 | 1 }>,
  fromCenter: boolean,
): ResizePoint {
  if (fromCenter) {
    return pointForResizeAxes(bounds, { x: 0, y: 0 });
  }
  return pointForResizeAxes(bounds, {
    x: axes.x === 0 ? 0 : axes.x === -1 ? 1 : -1,
    y: axes.y === 0 ? 0 : axes.y === -1 ? 1 : -1,
  });
}

function controllingResizeAxis(
  bounds: ResizeBounds,
  input: SelectionResizeProposalInput,
): AlignmentAxis {
  const axes = RESIZE_HANDLE_AXES[input.handle];
  if (axes.x === 0) return 'y';
  if (axes.y === 0) return 'x';
  const origin = pointForResizeAxes(bounds, axes);
  const anchor = resizeAnchor(bounds, axes, input.fromCenter);
  const scaleX =
    (origin.x + (input.currentPoint.x - input.startPoint.x) - anchor.x) / (origin.x - anchor.x);
  const scaleY =
    (origin.y + (input.currentPoint.y - input.startPoint.y) - anchor.y) / (origin.y - anchor.y);
  return Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? 'x' : 'y';
}

function movableResizeAnchors(
  bounds: ResizeBounds,
  input: SelectionResizeProposalInput,
  axis: AlignmentAxis,
): readonly ResizeAnchorResponse[] {
  const axes = RESIZE_HANDLE_AXES[input.handle];
  const direction = axes[axis];
  if (direction === 0) return Object.freeze([]);
  if (input.preserveAspectRatio && controllingResizeAxis(bounds, input) !== axis) {
    return Object.freeze([]);
  }
  const activeAnchor: AlignmentAnchor = direction < 0 ? 'min' : 'max';
  if (input.fromCenter) {
    const oppositeAnchor: AlignmentAnchor = direction < 0 ? 'max' : 'min';
    return Object.freeze([
      Object.freeze({ anchor: activeAnchor, response: 1 }),
      Object.freeze({ anchor: oppositeAnchor, response: -1 }),
    ]);
  }
  return Object.freeze([
    Object.freeze({ anchor: activeAnchor, response: 1 }),
    Object.freeze({ anchor: 'center', response: 0.5 }),
  ]);
}

function adjustedResizePoint(
  input: SelectionResizeProposalInput,
  axis: AlignmentAxis,
  correction: number,
  response: number,
): ResizePoint | null {
  const adjustment = correction / response;
  const x = axis === 'x' ? input.currentPoint.x + adjustment : input.currentPoint.x;
  const y = axis === 'y' ? input.currentPoint.y + adjustment : input.currentPoint.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Object.freeze({ x: canonicalPageCoordinate(x), y: canonicalPageCoordinate(y) });
}

function canonicalPageCoordinate(value: number): number {
  if (Object.is(value, -0)) return 0;
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) <= 1e-10 ? nearestInteger : value;
}

function samePageCoordinate(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function resizeCandidateForAxis(
  axis: AlignmentAxis,
  source: ResizeBounds,
  targets: readonly Target[],
  bounds: ResizeBounds,
  input: SelectionResizeProposalInput,
  propose: (input: SelectionResizeProposalInput) => Result<SelectionResizeProposal>,
): ResizeCandidate | null {
  let best: ResizeCandidate | null = null;
  const movableAnchors = movableResizeAnchors(bounds, input, axis);
  for (const target of targets) {
    for (const movable of movableAnchors) {
      const sourceOrder = ANCHORS.indexOf(movable.anchor);
      const sourceCoordinate = axisValue(source, axis, movable.anchor);
      for (let targetOrder = 0; targetOrder < ANCHORS.length; targetOrder += 1) {
        const targetAnchor = ANCHORS[targetOrder]!;
        const coordinate = axisValue(target.bounds, axis, targetAnchor);
        const correction = coordinate - sourceCoordinate;
        if (!Number.isFinite(correction) || Math.abs(correction) > ALIGNMENT_SNAP_THRESHOLD) {
          continue;
        }
        const currentPoint = adjustedResizePoint(input, axis, correction, movable.response);
        if (currentPoint === null) continue;
        const proposed = propose({ ...input, currentPoint });
        if (!proposed.ok || proposed.value.scaleX <= 0 || proposed.value.scaleY <= 0) continue;
        if (
          !samePageCoordinate(axisValue(proposed.value.bounds, axis, movable.anchor), coordinate)
        ) {
          continue;
        }
        const guide: AlignmentGuide = Object.freeze({
          axis,
          sourceAnchor: movable.anchor,
          targetAnchor,
          targetNodeId: target.nodeId,
          coordinate,
          minExtent:
            axis === 'x'
              ? Math.min(source.minY, target.bounds.minY)
              : Math.min(source.minX, target.bounds.minX),
          maxExtent:
            axis === 'x'
              ? Math.max(source.maxY, target.bounds.maxY)
              : Math.max(source.maxX, target.bounds.maxX),
        });
        const candidate: ResizeCandidate = {
          correction,
          guide,
          traversalOrder: target.traversalOrder,
          sourceOrder,
          targetOrder,
          currentPoint,
        };
        if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
      }
    }
  }
  return best;
}

function guidesForResizeBounds(
  guides: readonly AlignmentGuide[],
  source: ResizeBounds,
  targets: readonly Target[],
): readonly AlignmentGuide[] {
  const targetBounds = new Map(targets.map((target) => [target.nodeId as string, target.bounds]));
  return Object.freeze(
    guides.map((guide) => {
      const target = targetBounds.get(guide.targetNodeId as string)!;
      return Object.freeze({
        ...guide,
        minExtent:
          guide.axis === 'x'
            ? Math.min(source.minY, target.minY)
            : Math.min(source.minX, target.minX),
        maxExtent:
          guide.axis === 'x'
            ? Math.max(source.maxY, target.maxY)
            : Math.max(source.maxX, target.maxX),
      });
    }),
  );
}

function collectSelectedDescendants(
  nodes: ReadonlyMap<string, SceneNode>,
  selectedRoots: readonly NodeId[],
): ReadonlySet<string> {
  const selected = new Set<string>();
  const visit = (nodeId: string): void => {
    if (selected.has(nodeId)) return;
    selected.add(nodeId);
    const node = nodes.get(nodeId);
    if (node === undefined || !('childIds' in node)) return;
    for (const childId of node.childIds) visit(childId);
  };
  for (const nodeId of selectedRoots) visit(nodeId);
  return selected;
}

function supportsAxisAlignedAlignment(
  document: BringsDocument,
  nodes: ReadonlyMap<string, SceneNode>,
  indices: ReadonlyMap<string, number>,
  node: SceneNode,
): Result<boolean> {
  const matrix = pageMatrixForNode(
    document,
    node.id,
    `/nodes/${indices.get(node.id) ?? 0}/transform`,
  );
  if (!matrix.ok) return matrix;
  if (
    matrix.value[1] !== 0 ||
    matrix.value[2] !== 0 ||
    matrix.value[0] <= 0 ||
    matrix.value[3] <= 0
  ) {
    return success(false);
  }
  if (node.type !== 'group') return success(true);
  for (const childId of node.childIds) {
    const child = nodes.get(childId);
    if (child === undefined) {
      return failure('node.not-found', `/nodes/${indices.get(node.id) ?? 0}/childIds`);
    }
    const supported = supportsAxisAlignedAlignment(document, nodes, indices, child);
    if (!supported.ok || !supported.value) return supported;
  }
  return success(true);
}

function captureTargets(
  document: BringsDocument,
  nodes: ReadonlyMap<string, SceneNode>,
  indices: ReadonlyMap<string, number>,
  selected: ReadonlySet<string>,
): Result<readonly Target[]> {
  const page = document.pages.find((candidate) => candidate.id === document.activePageId);
  if (page === undefined) return failure('page.not-found', '/activePageId');
  const targets: Target[] = [];
  let traversalOrder = 0;
  const visit = (nodeId: NodeId, ancestorVisible: boolean): Result<void> => {
    const node = nodes.get(nodeId);
    if (node === undefined) return failure('node.not-found', '/pages');
    const visible = ancestorVisible && node.visible;
    const order = traversalOrder;
    traversalOrder += 1;
    if (visible && !selected.has(node.id)) {
      const supported = supportsAxisAlignedAlignment(document, nodes, indices, node);
      if (!supported.ok) return supported;
      if (!supported.value) {
        if ('childIds' in node) {
          for (const childId of node.childIds) {
            const visited = visit(childId, visible);
            if (!visited.ok) return visited;
          }
        }
        return success(undefined);
      }
      const bounds = nodeModelBounds(document, nodes, indices, node);
      if (!bounds.ok) return bounds;
      targets.push(
        Object.freeze({
          nodeId: node.id,
          bounds: freezeBounds(bounds.value),
          traversalOrder: order,
        }),
      );
    }
    if ('childIds' in node) {
      for (const childId of node.childIds) {
        const visited = visit(childId, visible);
        if (!visited.ok) return visited;
      }
    }
    return success(undefined);
  };
  for (const rootId of page.rootNodeIds) {
    const visited = visit(rootId, true);
    if (!visited.ok) return visited;
  }
  return success(Object.freeze(targets));
}

/**
 * Capture immutable active-page targets and resolve deterministic move alignment.
 * The captured document is never read again after this function returns.
 */
export function prepareSelectionAlignment(
  document: BringsDocument,
  input: SelectionInput,
): Result<PreparedSelectionAlignment> {
  const resolved = resolveStructuralSelection(document, input);
  if (!resolved.ok) return resolved;
  if (resolved.value.nodeIds.length === 0) return failure('selection.empty', '/nodeIds');

  const preparedResize = prepareSelectionResize(document, input);
  if (!preparedResize.ok) return preparedResize;

  const nodes = new Map(document.nodes.map((node) => [node.id as string, node]));
  const indices = new Map(document.nodes.map((node, index) => [node.id as string, index]));
  let aggregate: ResizeBounds | null = null;
  for (const nodeId of resolved.value.nodeIds) {
    const node = nodes.get(nodeId)!;
    const bounds = nodeModelBounds(document, nodes, indices, node);
    if (!bounds.ok) return bounds;
    aggregate = unionBounds(aggregate, bounds.value);
  }
  if (aggregate === null) return failure('resize.bounds-empty', '/nodeIds');
  const width = aggregate.maxX - aggregate.minX;
  const height = aggregate.maxY - aggregate.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return failure('geometry.computation-overflow', '/nodeIds');
  }
  if (width <= 0 || height <= 0) return failure('resize.bounds-singular', '/nodeIds');

  const targets = captureTargets(
    document,
    nodes,
    indices,
    collectSelectedDescendants(nodes, resolved.value.nodeIds),
  );
  if (!targets.ok) return targets;
  const selection = freezeSelection(resolved.value);
  const bounds = freezeBounds(aggregate);
  let sourceSupported = true;
  for (const nodeId of selection.nodeIds) {
    const supported = supportsAxisAlignedAlignment(document, nodes, indices, nodes.get(nodeId)!);
    if (!supported.ok) return supported;
    if (!supported.value) {
      sourceSupported = false;
      break;
    }
  }
  return success(
    Object.freeze({
      selection,
      bounds,
      resolveMove: (
        inputDelta: Readonly<{ x: number; y: number }>,
      ): Result<AlignmentMoveResult> => {
        const delta = finiteDelta(inputDelta);
        if (!delta.ok) return delta;
        const source = translateBounds(bounds, delta.value);
        const x = sourceSupported ? candidateForAxis('x', source, targets.value) : null;
        const y = sourceSupported ? candidateForAxis('y', source, targets.value) : null;
        const snapped = {
          x:
            x === null
              ? delta.value.x
              : x.guide.coordinate - axisValue(bounds, 'x', x.guide.sourceAnchor),
          y:
            y === null
              ? delta.value.y
              : y.guide.coordinate - axisValue(bounds, 'y', y.guide.sourceAnchor),
        };
        if (!Number.isFinite(snapped.x) || !Number.isFinite(snapped.y)) {
          return failure('geometry.computation-overflow', '/delta');
        }
        const guides = [x?.guide, y?.guide].filter(
          (guide): guide is AlignmentGuide => guide !== undefined,
        );
        return success(freezeMoveResult(snapped, guides));
      },
      resolveResize: (resizeInput: SelectionResizeProposalInput): Result<AlignmentResizeResult> => {
        const raw = preparedResize.value.propose(resizeInput);
        if (!raw.ok) return raw;
        const unsnapped = (): Result<AlignmentResizeResult> =>
          success(freezeResizeResult(resizeInput.currentPoint, raw.value, []));
        if (raw.value.scaleX <= 0 || raw.value.scaleY <= 0 || !sourceSupported) return unsnapped();

        const x = resizeCandidateForAxis(
          'x',
          raw.value.bounds,
          targets.value,
          bounds,
          resizeInput,
          preparedResize.value.propose,
        );
        const y = resizeCandidateForAxis(
          'y',
          raw.value.bounds,
          targets.value,
          bounds,
          resizeInput,
          preparedResize.value.propose,
        );
        if (x === null && y === null) return unsnapped();

        const currentPoint: ResizePoint = Object.freeze({
          x: x?.currentPoint.x ?? resizeInput.currentPoint.x,
          y: y?.currentPoint.y ?? resizeInput.currentPoint.y,
        });
        const snapped = preparedResize.value.propose({ ...resizeInput, currentPoint });
        if (!snapped.ok || snapped.value.scaleX <= 0 || snapped.value.scaleY <= 0)
          return unsnapped();

        const selected = [x, y].filter(
          (candidate): candidate is ResizeCandidate => candidate !== null,
        );
        if (
          selected.some(
            (candidate) =>
              !samePageCoordinate(
                axisValue(snapped.value.bounds, candidate.guide.axis, candidate.guide.sourceAnchor),
                candidate.guide.coordinate,
              ),
          )
        ) {
          return unsnapped();
        }
        const guides = guidesForResizeBounds(
          selected.map((candidate) => candidate.guide),
          snapped.value.bounds,
          targets.value,
        );
        return success(freezeResizeResult(currentPoint, snapped.value, guides));
      },
    }),
  );
}

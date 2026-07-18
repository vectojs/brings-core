import { resolveStructuralSelection } from '../document/selection';
import { validateMatrixInput } from '../document/validate';
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

/** One of the eight axis-aligned handles around a prepared selection. */
export type ResizeHandle =
  'north-west' | 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west';

/** One finite point in document page space. */
export type ResizePoint = Readonly<{ x: number; y: number }>;

/** Detached axis-aligned page bounds for a resize plan or proposal. */
export type ResizeBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

/** One immutable handle center derived from the prepared selection bounds. */
export type ResizeHandlePosition = Readonly<{
  handle: ResizeHandle;
  point: ResizePoint;
}>;

/** Pure input for proposing one resize from an arbitrary pointer-down position. */
export type SelectionResizeProposalInput = Readonly<{
  handle: ResizeHandle;
  startPoint: ResizePoint;
  currentPoint: ResizePoint;
  preserveAspectRatio: boolean;
  fromCenter: boolean;
}>;

/** Exact document command produced by a valid resize proposal. */
export type SelectionResizeCommand = Readonly<{
  kind: 'apply-transform-delta';
  nodeIds: readonly NodeId[];
  delta: Matrix;
}>;

/** Detached preview and exact command for one valid pointer position. */
export type SelectionResizeProposal = Readonly<{
  handle: ResizeHandle;
  anchor: ResizePoint;
  scaleX: number;
  scaleY: number;
  bounds: ResizeBounds;
  command: SelectionResizeCommand;
}>;

/** Renderer-free resize geometry prepared for one normalized structural selection. */
export type PreparedSelectionResize = Readonly<{
  selection: StructuralSelection;
  bounds: ResizeBounds;
  handles: readonly ResizeHandlePosition[];
  propose(input: SelectionResizeProposalInput): Result<SelectionResizeProposal>;
}>;

type HandleAxes = Readonly<{ x: -1 | 0 | 1; y: -1 | 0 | 1 }>;

const HANDLE_ORDER: readonly ResizeHandle[] = Object.freeze([
  'north-west',
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
]);

const HANDLE_AXES: Readonly<Record<ResizeHandle, HandleAxes>> = Object.freeze({
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

function freezePoint(point: ResizePoint): ResizePoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeBounds(bounds: ResizeBounds): ResizeBounds {
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function freezeMatrix(matrix: Matrix): Matrix {
  return Object.freeze([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4],
    matrix[5],
  ]) as Matrix;
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

  if (node.type === 'path') return failure('path.geometry-unsupported', path);

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

function pointForAxes(bounds: ResizeBounds, axes: HandleAxes): ResizePoint {
  const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
  const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
  return {
    x: axes.x < 0 ? bounds.minX : axes.x > 0 ? bounds.maxX : centerX,
    y: axes.y < 0 ? bounds.minY : axes.y > 0 ? bounds.maxY : centerY,
  };
}

function handlePositions(bounds: ResizeBounds): readonly ResizeHandlePosition[] {
  return Object.freeze(
    HANDLE_ORDER.map((handle) =>
      Object.freeze({ handle, point: freezePoint(pointForAxes(bounds, HANDLE_AXES[handle])) }),
    ),
  );
}

function oppositeAnchor(bounds: ResizeBounds, axes: HandleAxes): ResizePoint {
  return pointForAxes(bounds, {
    x: axes.x === 0 ? 0 : axes.x === -1 ? 1 : -1,
    y: axes.y === 0 ? 0 : axes.y === -1 ? 1 : -1,
  });
}

function center(bounds: ResizeBounds): ResizePoint {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) / 2,
    y: bounds.minY + (bounds.maxY - bounds.minY) / 2,
  };
}

function finitePoint(value: unknown, path: string): Result<ResizePoint> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failure('geometry.point-invalid', path);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.x !== 'number' || !Number.isFinite(record.x)) {
    return failure('geometry.point-invalid', `${path}/x`);
  }
  if (typeof record.y !== 'number' || !Number.isFinite(record.y)) {
    return failure('geometry.point-invalid', `${path}/y`);
  }
  return success({ x: record.x, y: record.y });
}

function checked(value: number, path: string): Result<number> {
  return Number.isFinite(value)
    ? success(Object.is(value, -0) ? 0 : value)
    : failure('geometry.computation-overflow', path);
}

function uniformFactor(scaleX: number, scaleY: number, axes: HandleAxes): number {
  if (axes.x === 0) return scaleY;
  if (axes.y === 0) return scaleX;
  return Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
}

function proposedBounds(bounds: ResizeBounds, delta: Matrix): Result<ResizeBounds> {
  const polygon = transformPolygon(
    delta,
    rectanglePolygon(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    ),
    '/delta',
  );
  if (!polygon.ok) return polygon;
  const projected = polygonBounds(polygon.value);
  return projected === null
    ? failure('geometry.computation-overflow', '/delta')
    : success(projected);
}

function createProposal(
  bounds: ResizeBounds,
  handles: ReadonlyMap<ResizeHandle, ResizePoint>,
  selection: StructuralSelection,
  input: SelectionResizeProposalInput,
): Result<SelectionResizeProposal> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('resize.proposal-invalid', '/');
  }
  if (!HANDLE_ORDER.includes(input.handle)) return failure('resize.handle', '/handle');
  const startPoint = finitePoint(input.startPoint, '/startPoint');
  if (!startPoint.ok) return startPoint;
  const currentPoint = finitePoint(input.currentPoint, '/currentPoint');
  if (!currentPoint.ok) return currentPoint;
  if (typeof input.preserveAspectRatio !== 'boolean') {
    return failure('value.boolean', '/preserveAspectRatio');
  }
  if (typeof input.fromCenter !== 'boolean') return failure('value.boolean', '/fromCenter');

  const axes = HANDLE_AXES[input.handle];
  const origin = handles.get(input.handle)!;
  const pointerDeltaX = checked(currentPoint.value.x - startPoint.value.x, '/currentPoint/x');
  if (!pointerDeltaX.ok) return pointerDeltaX;
  const pointerDeltaY = checked(currentPoint.value.y - startPoint.value.y, '/currentPoint/y');
  if (!pointerDeltaY.ok) return pointerDeltaY;
  const draggedX = checked(origin.x + pointerDeltaX.value, '/currentPoint/x');
  if (!draggedX.ok) return draggedX;
  const draggedY = checked(origin.y + pointerDeltaY.value, '/currentPoint/y');
  if (!draggedY.ok) return draggedY;

  const anchor = input.fromCenter ? center(bounds) : oppositeAnchor(bounds, axes);
  let scaleX = 1;
  let scaleY = 1;
  if (axes.x !== 0) {
    const factor = checked((draggedX.value - anchor.x) / (origin.x - anchor.x), '/currentPoint/x');
    if (!factor.ok) return factor;
    scaleX = factor.value;
  }
  if (axes.y !== 0) {
    const factor = checked((draggedY.value - anchor.y) / (origin.y - anchor.y), '/currentPoint/y');
    if (!factor.ok) return factor;
    scaleY = factor.value;
  }
  if (input.preserveAspectRatio) {
    const factor = uniformFactor(scaleX, scaleY, axes);
    scaleX = factor;
    scaleY = factor;
  }

  const translateX = checked(anchor.x * (1 - scaleX), '/delta/4');
  if (!translateX.ok) return translateX;
  const translateY = checked(anchor.y * (1 - scaleY), '/delta/5');
  if (!translateY.ok) return translateY;
  const deltaInput = [scaleX, 0, 0, scaleY, translateX.value, translateY.value];
  const validatedDelta = validateMatrixInput(deltaInput, '/delta');
  if (!validatedDelta.ok) return validatedDelta;
  const delta = freezeMatrix(validatedDelta.value);
  const projected = proposedBounds(bounds, delta);
  if (!projected.ok) return projected;
  const frozenAnchor = freezePoint(anchor);
  const command: SelectionResizeCommand = Object.freeze({
    kind: 'apply-transform-delta',
    nodeIds: Object.freeze([...selection.nodeIds]),
    delta,
  });
  return success(
    Object.freeze({
      handle: input.handle,
      anchor: frozenAnchor,
      scaleX,
      scaleY,
      bounds: freezeBounds(projected.value),
      command,
    }),
  );
}

/** Prepare immutable model bounds and pure affine proposals for one selection. */
export function prepareSelectionResize(
  document: BringsDocument,
  input: SelectionInput,
): Result<PreparedSelectionResize> {
  const resolved = resolveStructuralSelection(document, input);
  if (!resolved.ok) return resolved;
  if (resolved.value.nodeIds.length === 0) return failure('selection.empty', '/nodeIds');

  const nodes = new Map(document.nodes.map((node) => [node.id as string, node]));
  const indices = new Map(document.nodes.map((node, index) => [node.id as string, index]));
  let aggregate: ResizeBounds | null = null;
  for (const nodeId of resolved.value.nodeIds) {
    const node = nodes.get(nodeId)!;
    const nodeBounds = nodeModelBounds(document, nodes, indices, node);
    if (!nodeBounds.ok) return nodeBounds;
    aggregate = unionBounds(aggregate, nodeBounds.value);
  }
  if (aggregate === null) return failure('resize.bounds-empty', '/nodeIds');
  const width = aggregate.maxX - aggregate.minX;
  const height = aggregate.maxY - aggregate.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return failure('geometry.computation-overflow', '/nodeIds');
  }
  if (width <= 0 || height <= 0) return failure('resize.bounds-singular', '/nodeIds');

  const selection = freezeSelection(resolved.value);
  const bounds = freezeBounds(aggregate);
  const handles = handlePositions(bounds);
  const handleMap = new Map(handles.map((entry) => [entry.handle, entry.point]));
  const prepared: PreparedSelectionResize = Object.freeze({
    selection,
    bounds,
    handles,
    propose: (proposalInput: SelectionResizeProposalInput) =>
      createProposal(bounds, handleMap, selection, proposalInput),
  });
  return success(prepared);
}

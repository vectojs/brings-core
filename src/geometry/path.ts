import type { Matrix, PathNetwork, PathPoint, Result, UUID } from '../document/types';
import { transformPoint, type Bounds, type GeometryPoint, type Polygon } from './intersection';

/** One ordered cubic segment resolved from a Path network. */
export type OrderedPathCubic = Readonly<{
  segmentId: UUID;
  start: PathPoint;
  startControl: PathPoint;
  endControl: PathPoint;
  end: PathPoint;
}>;

/** One ordered open chain or closed cycle in a validated Path network. */
export type OrderedPathComponent = Readonly<{
  cubics: readonly [OrderedPathCubic, ...OrderedPathCubic[]];
  closed: boolean;
}>;

/** One adaptively flattened Path component. */
export type FlattenedPathComponent = Readonly<{
  points: readonly [PathPoint, PathPoint, ...PathPoint[]];
  closed: boolean;
}>;

const MAX_FLATTEN_DEPTH = 12;
const MAX_FLATTENED_POINTS = 262_144;

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function finitePoint(x: number, y: number, path: string): Result<PathPoint> {
  return Number.isFinite(x) && Number.isFinite(y)
    ? success({ x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y })
    : failure('geometry.computation-overflow', path);
}

function offsetPoint(point: PathPoint, offset: PathPoint, path: string): Result<PathPoint> {
  return finitePoint(point.x + offset.x, point.y + offset.y, path);
}

function freezePoint(point: PathPoint): PathPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

/** Resolve stable network identities into deterministic ordered cubic components. */
export function orderPathNetwork(
  network: PathNetwork,
  path = '/network',
): Result<readonly OrderedPathComponent[]> {
  const vertices = new Map(network.vertices.map((vertex) => [vertex.id, vertex]));
  const adjacency = new Map<string, number[]>();
  for (const vertex of network.vertices) adjacency.set(vertex.id, []);
  for (let index = 0; index < network.segments.length; index += 1) {
    const segment = network.segments[index]!;
    const start = adjacency.get(segment.startVertexId);
    const end = adjacency.get(segment.endVertexId);
    if (start === undefined || end === undefined) {
      return failure('geometry.document-invariant', `${path}/segments/${index}`);
    }
    start.push(index);
    end.push(index);
  }

  const visited = new Set<number>();
  const nextUnvisited = (vertexId: string): number | undefined =>
    adjacency.get(vertexId)?.find((segmentIndex) => !visited.has(segmentIndex));
  const components: OrderedPathComponent[] = [];
  const candidateStarts = [
    ...network.vertices.filter((vertex) => adjacency.get(vertex.id)?.length === 1),
    ...network.vertices.filter((vertex) => adjacency.get(vertex.id)?.length !== 1),
  ];
  let candidateIndex = 0;

  while (visited.size < network.segments.length) {
    while (
      candidateIndex < candidateStarts.length &&
      nextUnvisited(candidateStarts[candidateIndex]!.id) === undefined
    ) {
      candidateIndex += 1;
    }
    const startVertex = candidateStarts[candidateIndex];
    if (startVertex === undefined) return failure('geometry.document-invariant', path);

    const cubics: OrderedPathCubic[] = [];
    let currentId: UUID = startVertex.id;
    while (true) {
      const segmentIndex = nextUnvisited(currentId);
      if (segmentIndex === undefined) break;
      const segment = network.segments[segmentIndex]!;
      visited.add(segmentIndex);
      const forward = segment.startVertexId === currentId;
      const nextId = forward ? segment.endVertexId : segment.startVertexId;
      const start = vertices.get(currentId)?.position;
      const end = vertices.get(nextId)?.position;
      if (start === undefined || end === undefined) {
        return failure('geometry.document-invariant', `${path}/segments/${segmentIndex}`);
      }
      const startOffset = forward ? segment.startControl : segment.endControl;
      const endOffset = forward ? segment.endControl : segment.startControl;
      const startControl = offsetPoint(
        start,
        startOffset,
        `${path}/segments/${segmentIndex}/startControl`,
      );
      if (!startControl.ok) return startControl;
      const endControl = offsetPoint(end, endOffset, `${path}/segments/${segmentIndex}/endControl`);
      if (!endControl.ok) return endControl;
      cubics.push({
        segmentId: segment.id,
        start: { x: start.x, y: start.y },
        startControl: startControl.value,
        endControl: endControl.value,
        end: { x: end.x, y: end.y },
      });
      currentId = nextId;
      if (currentId === startVertex.id) break;
    }
    if (cubics.length === 0) return failure('geometry.document-invariant', path);
    components.push({
      cubics: cubics as [OrderedPathCubic, ...OrderedPathCubic[]],
      closed: currentId === startVertex.id,
    });
  }

  return success(
    Object.freeze(
      components.map((component) =>
        Object.freeze({
          closed: component.closed,
          cubics: Object.freeze(
            component.cubics.map((cubic) =>
              Object.freeze({
                segmentId: cubic.segmentId,
                start: freezePoint(cubic.start),
                startControl: freezePoint(cubic.startControl),
                endControl: freezePoint(cubic.endControl),
                end: freezePoint(cubic.end),
              }),
            ),
          ) as readonly [OrderedPathCubic, ...OrderedPathCubic[]],
        }),
      ),
    ),
  );
}

function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inverse = 1 - t;
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * t * p1 +
    3 * inverse * t * t * p2 +
    t * t * t * p3
  );
}

function derivativeRoots(p0: number, p1: number, p2: number, p3: number): number[] | null {
  const quadratic = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const linear = 6 * (p0 - 2 * p1 + p2);
  const constant = 3 * (p1 - p0);
  if (![quadratic, linear, constant].every(Number.isFinite)) return null;
  const epsilon =
    Number.EPSILON * Math.max(1, Math.abs(quadratic), Math.abs(linear), Math.abs(constant)) * 32;
  if (Math.abs(quadratic) <= epsilon) {
    if (Math.abs(linear) <= epsilon) return [];
    const root = -constant / linear;
    return Number.isFinite(root) ? [root] : null;
  }
  const discriminant = linear * linear - 4 * quadratic * constant;
  const linearSquared = linear * linear;
  const quadraticConstant = 4 * quadratic * constant;
  if (![linearSquared, quadraticConstant, discriminant].every(Number.isFinite)) return null;
  const discriminantEpsilon =
    Number.EPSILON * Math.max(1, Math.abs(linearSquared), Math.abs(quadraticConstant)) * 64;
  if (discriminant < -discriminantEpsilon) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const denominator = 2 * quadratic;
  const first = (-linear - root) / denominator;
  const second = (-linear + root) / denominator;
  return [first, second].filter(Number.isFinite);
}

function includeCubicBounds(
  bounds: Bounds | null,
  cubic: OrderedPathCubic,
  matrix: Matrix,
  path: string,
): Result<Bounds> {
  const transformed: GeometryPoint[] = [];
  for (const point of [cubic.start, cubic.startControl, cubic.endControl, cubic.end]) {
    const result = transformPoint(matrix, point, path);
    if (!result.ok) return result;
    transformed.push(result.value);
  }
  const [p0, p1, p2, p3] = transformed as [
    GeometryPoint,
    GeometryPoint,
    GeometryPoint,
    GeometryPoint,
  ];
  const xRoots = derivativeRoots(p0.x, p1.x, p2.x, p3.x);
  const yRoots = derivativeRoots(p0.y, p1.y, p2.y, p3.y);
  if (xRoots === null || yRoots === null) return failure('geometry.computation-overflow', path);
  const points: GeometryPoint[] = [p0, p3];
  for (const root of xRoots) {
    if (root <= 0 || root >= 1) continue;
    points.push({ x: cubicValue(p0.x, p1.x, p2.x, p3.x, root), y: p0.y });
  }
  for (const root of yRoots) {
    if (root <= 0 || root >= 1) continue;
    points.push({ x: p0.x, y: cubicValue(p0.y, p1.y, p2.y, p3.y, root) });
  }
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return failure('geometry.computation-overflow', path);
  }
  let next = bounds ?? {
    minX: points[0]!.x,
    minY: points[0]!.y,
    maxX: points[0]!.x,
    maxY: points[0]!.y,
  };
  for (const point of points) {
    next = {
      minX: Math.min(next.minX, point.x),
      minY: Math.min(next.minY, point.y),
      maxX: Math.max(next.maxX, point.x),
      maxY: Math.max(next.maxY, point.y),
    };
  }
  return success(next);
}

/** Compute exact endpoint/derivative-extrema bounds after one affine transform. */
export function pathNetworkBounds(
  network: PathNetwork,
  matrix: Matrix,
  path = '/network',
): Result<Bounds> {
  const components = orderPathNetwork(network, path);
  if (!components.ok) return components;
  let bounds: Bounds | null = null;
  for (const component of components.value) {
    for (const cubic of component.cubics) {
      const included = includeCubicBounds(bounds, cubic, matrix, path);
      if (!included.ok) return included;
      bounds = included.value;
    }
  }
  return bounds === null ? failure('geometry.document-invariant', path) : success(bounds);
}

function midpoint(left: PathPoint, right: PathPoint): PathPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function pointLineDistance(point: PathPoint, start: PathPoint, end: PathPoint): number {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const length = Math.hypot(x, y);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(x * (start.y - point.y) - (start.x - point.x) * y) / length;
}

function controlsAreOrdered(cubic: OrderedPathCubic): boolean {
  const x = cubic.end.x - cubic.start.x;
  const y = cubic.end.y - cubic.start.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) return false;
  const first =
    ((cubic.startControl.x - cubic.start.x) * x + (cubic.startControl.y - cubic.start.y) * y) /
    lengthSquared;
  const second =
    ((cubic.endControl.x - cubic.start.x) * x + (cubic.endControl.y - cubic.start.y) * y) /
    lengthSquared;
  return first >= 0 && first <= second && second <= 1;
}

function isFlat(cubic: OrderedPathCubic, tolerance: number): boolean {
  if (!controlsAreOrdered(cubic)) return false;
  return (
    pointLineDistance(cubic.startControl, cubic.start, cubic.end) <= tolerance &&
    pointLineDistance(cubic.endControl, cubic.start, cubic.end) <= tolerance
  );
}

function splitCubic(cubic: OrderedPathCubic): readonly [OrderedPathCubic, OrderedPathCubic] {
  const startToControl = midpoint(cubic.start, cubic.startControl);
  const controlToControl = midpoint(cubic.startControl, cubic.endControl);
  const controlToEnd = midpoint(cubic.endControl, cubic.end);
  const leftControl = midpoint(startToControl, controlToControl);
  const rightControl = midpoint(controlToControl, controlToEnd);
  const middle = midpoint(leftControl, rightControl);
  return [
    {
      segmentId: cubic.segmentId,
      start: cubic.start,
      startControl: startToControl,
      endControl: leftControl,
      end: middle,
    },
    {
      segmentId: cubic.segmentId,
      start: middle,
      startControl: rightControl,
      endControl: controlToEnd,
      end: cubic.end,
    },
  ];
}

/** Flatten all components with bounded de Casteljau subdivision. */
export function flattenPathNetwork(
  network: PathNetwork,
  tolerance: number,
  path = '/network',
): Result<readonly FlattenedPathComponent[]> {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return failure('geometry.tolerance-invalid', `${path}/tolerance`);
  }
  const ordered = orderPathNetwork(network, path);
  if (!ordered.ok) return ordered;
  let pointCount = 0;
  const flattened: FlattenedPathComponent[] = [];

  for (const component of ordered.value) {
    const points: PathPoint[] = [{ ...component.cubics[0]!.start }];
    pointCount += 1;
    let complexityExceeded = false;
    const append = (cubic: OrderedPathCubic, depth: number): void => {
      if (complexityExceeded) return;
      if (isFlat(cubic, tolerance)) {
        points.push({ ...cubic.end });
        pointCount += 1;
        if (pointCount > MAX_FLATTENED_POINTS) complexityExceeded = true;
        return;
      }
      if (depth >= MAX_FLATTEN_DEPTH) {
        complexityExceeded = true;
        return;
      }
      const [left, right] = splitCubic(cubic);
      append(left, depth + 1);
      append(right, depth + 1);
    };
    for (const cubic of component.cubics) append(cubic, 0);
    if (complexityExceeded) return failure('geometry.path-complexity', path);
    flattened.push({
      closed: component.closed,
      points: points as [PathPoint, PathPoint, ...PathPoint[]],
    });
  }

  return success(
    Object.freeze(
      flattened.map((component) =>
        Object.freeze({
          closed: component.closed,
          points: Object.freeze(component.points.map(freezePoint)) as readonly [
            PathPoint,
            PathPoint,
            ...PathPoint[],
          ],
        }),
      ),
    ),
  );
}

function geometryEpsilon(points: readonly GeometryPoint[]): number {
  let maximum = 1;
  for (const point of points) maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
  return 1e-9 * maximum;
}

function pointSegmentDistance(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
): number {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + projection * x), point.y - (start.y + projection * y));
}

function cross(start: GeometryPoint, end: GeometryPoint, point: GeometryPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function pointOnSegment(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
  epsilon: number,
): boolean {
  const crossTolerance = epsilon * Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  return (
    Math.abs(cross(start, end, point)) <= crossTolerance &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

function segmentsIntersect(
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
  epsilon: number,
): boolean {
  if (
    pointOnSegment(leftStart, rightStart, rightEnd, epsilon) ||
    pointOnSegment(leftEnd, rightStart, rightEnd, epsilon) ||
    pointOnSegment(rightStart, leftStart, leftEnd, epsilon) ||
    pointOnSegment(rightEnd, leftStart, leftEnd, epsilon)
  ) {
    return true;
  }
  const leftA = cross(leftStart, leftEnd, rightStart);
  const leftB = cross(leftStart, leftEnd, rightEnd);
  const rightA = cross(rightStart, rightEnd, leftStart);
  const rightB = cross(rightStart, rightEnd, leftEnd);
  const leftTolerance =
    epsilon * Math.max(1, Math.hypot(leftEnd.x - leftStart.x, leftEnd.y - leftStart.y));
  const rightTolerance =
    epsilon * Math.max(1, Math.hypot(rightEnd.x - rightStart.x, rightEnd.y - rightStart.y));
  const leftOpposite =
    (leftA > leftTolerance && leftB < -leftTolerance) ||
    (leftA < -leftTolerance && leftB > leftTolerance);
  const rightOpposite =
    (rightA > rightTolerance && rightB < -rightTolerance) ||
    (rightA < -rightTolerance && rightB > rightTolerance);
  return leftOpposite && rightOpposite;
}

function segmentDistance(
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
  epsilon: number,
): number {
  if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd, epsilon)) return 0;
  return Math.min(
    pointSegmentDistance(leftStart, rightStart, rightEnd),
    pointSegmentDistance(leftEnd, rightStart, rightEnd),
    pointSegmentDistance(rightStart, leftStart, leftEnd),
    pointSegmentDistance(rightEnd, leftStart, leftEnd),
  );
}

function polygonEdges(polygon: Polygon): readonly (readonly [GeometryPoint, GeometryPoint])[] {
  if (polygon.length === 0) return [];
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!] as const);
}

function pointInPolygon(point: GeometryPoint, polygon: Polygon, epsilon: number): boolean {
  const edges = polygonEdges(polygon);
  if (edges.some(([start, end]) => pointOnSegment(point, start, end, epsilon))) return true;
  let inside = false;
  for (const [start, end] of edges) {
    if (start.y > point.y === end.y > point.y) continue;
    const crossingX = start.x + ((point.y - start.y) * (end.x - start.x)) / (end.y - start.y);
    if (crossingX > point.x) inside = !inside;
  }
  return inside;
}

function compoundContains(
  point: GeometryPoint,
  components: readonly FlattenedPathComponent[],
  fillRule: 'nonzero' | 'evenodd',
  epsilon: number,
): boolean {
  let winding = 0;
  let parity = false;
  for (const component of components) {
    if (!component.closed) continue;
    for (let index = 0; index + 1 < component.points.length; index += 1) {
      const start = component.points[index]!;
      const end = component.points[index + 1]!;
      if (pointOnSegment(point, start, end, epsilon)) return true;
      if (start.y > point.y === end.y > point.y) continue;
      const crossingX = start.x + ((point.y - start.y) * (end.x - start.x)) / (end.y - start.y);
      if (crossingX <= point.x) continue;
      parity = !parity;
      winding += end.y > start.y ? 1 : -1;
    }
  }
  return fillRule === 'evenodd' ? parity : winding !== 0;
}

/** Deterministic query narrow phase over detached flattened Path geometry. */
export function flattenedPathIntersectsPolygon(
  components: readonly FlattenedPathComponent[],
  query: Polygon,
  options: Readonly<{
    fillRule: 'nonzero' | 'evenodd';
    hasFill: boolean;
    hasStroke: boolean;
    strokeExpansion: number;
  }>,
  path: string,
): Result<boolean> {
  const allPoints = [...query, ...components.flatMap((component) => component.points)];
  if (allPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return failure('geometry.computation-overflow', path);
  }
  let maximumCoordinate = 0;
  for (const point of allPoints) {
    maximumCoordinate = Math.max(maximumCoordinate, Math.abs(point.x), Math.abs(point.y));
  }
  if (maximumCoordinate > Math.sqrt(Number.MAX_VALUE) / 4) {
    return failure('geometry.computation-overflow', path);
  }
  if (query.length === 0) return success(false);
  const epsilon = geometryEpsilon(allPoints);
  const queryEdges = polygonEdges(query);
  const pathEdges = components.flatMap((component) =>
    component.points
      .slice(0, -1)
      .map((start, index) => [start, component.points[index + 1]!] as const),
  );

  if (options.hasFill) {
    if (
      pathEdges.some(([start, end]) =>
        queryEdges.some(([queryStart, queryEnd]) =>
          segmentsIntersect(start, end, queryStart, queryEnd, epsilon),
        ),
      )
    ) {
      return success(true);
    }
    if (
      query.some((point) => compoundContains(point, components, options.fillRule, epsilon)) ||
      components.some(
        (component) => component.closed && pointInPolygon(component.points[0]!, query, epsilon),
      )
    ) {
      return success(true);
    }
  }

  if (options.hasStroke || !options.hasFill) {
    const maximumDistance = Math.max(0, options.strokeExpansion) + epsilon;
    for (const [start, end] of pathEdges) {
      if (pointInPolygon(start, query, epsilon) || pointInPolygon(end, query, epsilon)) {
        return success(true);
      }
      if (
        queryEdges.some(
          ([queryStart, queryEnd]) =>
            segmentDistance(start, end, queryStart, queryEnd, epsilon) <= maximumDistance,
        )
      ) {
        return success(true);
      }
    }
  }
  return success(false);
}

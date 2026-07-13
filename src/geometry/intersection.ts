import type { Matrix, Result } from '../document/types';

export type GeometryPoint = Readonly<{ x: number; y: number }>;
export type Polygon = readonly GeometryPoint[];
export type Bounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

const GEOMETRY_EPSILON = 1e-9;

type Computation = { readonly path: string; overflowed: boolean };

function failure(path: string): Result<never> {
  return { ok: false, error: { code: 'geometry.computation-overflow', path } };
}

function finish<T>(computation: Computation, value: T): Result<T> {
  return computation.overflowed ? failure(computation.path) : { ok: true, value };
}

function checked(computation: Computation, value: number): number {
  if (!Number.isFinite(value)) computation.overflowed = true;
  return value;
}

function tolerance(values: readonly number[]): number {
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  return GEOMETRY_EPSILON * scale;
}

function checkedTolerance(computation: Computation, values: readonly number[]): number {
  for (const value of values) checked(computation, value);
  return checked(computation, tolerance(values));
}

function validatePolygon(computation: Computation, polygon: Polygon): void {
  for (const point of polygon) {
    checked(computation, point.x);
    checked(computation, point.y);
  }
}

function cross(
  computation: Computation,
  start: GeometryPoint,
  end: GeometryPoint,
  point: GeometryPoint,
): number {
  const edgeX = checked(computation, end.x - start.x);
  const edgeY = checked(computation, end.y - start.y);
  const pointX = checked(computation, point.x - start.x);
  const pointY = checked(computation, point.y - start.y);
  const positive = checked(computation, edgeX * pointY);
  const negative = checked(computation, edgeY * pointX);
  return checked(computation, positive - negative);
}

function signedArea(computation: Computation, polygon: Polygon): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    const positive = checked(computation, current.x * next.y);
    const negative = checked(computation, next.x * current.y);
    const term = checked(computation, positive - negative);
    area = checked(computation, area + term);
  }
  return checked(computation, area / 2);
}

function isDegeneratePolygon(computation: Computation, polygon: Polygon): boolean {
  const area = signedArea(computation, polygon);
  const areaEpsilon = checkedTolerance(
    computation,
    polygon.flatMap((point) => [point.x, point.y, area]),
  );
  return Math.abs(area) <= areaEpsilon;
}

function insideHalfPlane(
  computation: Computation,
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
  windingSign: number,
): boolean {
  const value = checked(computation, cross(computation, start, end, point) * windingSign);
  const epsilon = checkedTolerance(computation, [
    start.x,
    start.y,
    end.x,
    end.y,
    point.x,
    point.y,
    value,
  ]);
  return value >= -epsilon;
}

function pointsEqual(computation: Computation, left: GeometryPoint, right: GeometryPoint): boolean {
  const epsilon = checkedTolerance(computation, [left.x, left.y, right.x, right.y]);
  const deltaX = checked(computation, left.x - right.x);
  const deltaY = checked(computation, left.y - right.y);
  return Math.abs(deltaX) <= epsilon && Math.abs(deltaY) <= epsilon;
}

function pointOnSegment(
  computation: Computation,
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
): boolean {
  if (pointsEqual(computation, start, end)) return pointsEqual(computation, point, start);
  const crossProduct = cross(computation, start, end, point);
  const epsilon = checkedTolerance(computation, [
    start.x,
    start.y,
    end.x,
    end.y,
    point.x,
    point.y,
    crossProduct,
  ]);
  const minX = checked(computation, Math.min(start.x, end.x) - epsilon);
  const maxX = checked(computation, Math.max(start.x, end.x) + epsilon);
  const minY = checked(computation, Math.min(start.y, end.y) - epsilon);
  const maxY = checked(computation, Math.max(start.y, end.y) + epsilon);
  return (
    Math.abs(crossProduct) <= epsilon &&
    point.x >= minX &&
    point.x <= maxX &&
    point.y >= minY &&
    point.y <= maxY
  );
}

function segmentLineIntersection(
  computation: Computation,
  start: GeometryPoint,
  end: GeometryPoint,
  clipStart: GeometryPoint,
  clipEnd: GeometryPoint,
  acceptedEndpoint: GeometryPoint,
): GeometryPoint {
  const subjectX = checked(computation, end.x - start.x);
  const subjectY = checked(computation, end.y - start.y);
  const clipX = checked(computation, clipEnd.x - clipStart.x);
  const clipY = checked(computation, clipEnd.y - clipStart.y);
  const positive = checked(computation, subjectX * clipY);
  const negative = checked(computation, subjectY * clipX);
  const denominator = checked(computation, positive - negative);
  const epsilon = checkedTolerance(computation, [
    start.x,
    start.y,
    end.x,
    end.y,
    clipStart.x,
    clipStart.y,
    clipEnd.x,
    clipEnd.y,
    denominator,
  ]);

  if (Math.abs(subjectX) <= epsilon && Math.abs(subjectY) <= epsilon) {
    return pointOnSegment(computation, start, clipStart, clipEnd) ? start : acceptedEndpoint;
  }
  if (Math.abs(denominator) <= epsilon) return acceptedEndpoint;

  const offsetX = checked(computation, clipStart.x - start.x);
  const offsetY = checked(computation, clipStart.y - start.y);
  const numeratorPositive = checked(computation, offsetX * clipY);
  const numeratorNegative = checked(computation, offsetY * clipX);
  const numerator = checked(computation, numeratorPositive - numeratorNegative);
  const parameter = checked(computation, numerator / denominator);
  const xOffset = checked(computation, parameter * subjectX);
  const yOffset = checked(computation, parameter * subjectY);
  return {
    x: checked(computation, start.x + xOffset),
    y: checked(computation, start.y + yOffset),
  };
}

function pointInConvexPolygon(
  computation: Computation,
  point: GeometryPoint,
  polygon: Polygon,
): boolean {
  if (polygon.length === 0) return false;
  if (polygon.length === 1) return pointsEqual(computation, point, polygon[0]!);
  if (polygon.length === 2) {
    return pointOnSegment(computation, point, polygon[0]!, polygon[1]!);
  }

  const area = signedArea(computation, polygon);
  if (isDegeneratePolygon(computation, polygon)) {
    return polygon.some((start, index) =>
      pointOnSegment(computation, point, start, polygon[(index + 1) % polygon.length]!),
    );
  }
  const windingSign = area > 0 ? 1 : -1;
  return polygon.every((start, index) =>
    insideHalfPlane(computation, point, start, polygon[(index + 1) % polygon.length]!, windingSign),
  );
}

function segmentsIntersect(
  computation: Computation,
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
): boolean {
  if (
    pointOnSegment(computation, leftStart, rightStart, rightEnd) ||
    pointOnSegment(computation, leftEnd, rightStart, rightEnd) ||
    pointOnSegment(computation, rightStart, leftStart, leftEnd) ||
    pointOnSegment(computation, rightEnd, leftStart, leftEnd)
  ) {
    return true;
  }

  const leftCrossStart = cross(computation, leftStart, leftEnd, rightStart);
  const leftCrossEnd = cross(computation, leftStart, leftEnd, rightEnd);
  const rightCrossStart = cross(computation, rightStart, rightEnd, leftStart);
  const rightCrossEnd = cross(computation, rightStart, rightEnd, leftEnd);
  const leftProduct = checked(computation, leftCrossStart * leftCrossEnd);
  const rightProduct = checked(computation, rightCrossStart * rightCrossEnd);
  return leftProduct < 0 && rightProduct < 0;
}

function polygonSegments(polygon: Polygon): readonly (readonly [GeometryPoint, GeometryPoint])[] {
  if (polygon.length < 2) return [];
  if (polygon.length === 2) return [[polygon[0]!, polygon[1]!]];
  return polygon.map((start, index) => [start, polygon[(index + 1) % polygon.length]!] as const);
}

function clipConvexPolygonValue(
  computation: Computation,
  subject: Polygon,
  clip: Polygon,
): Polygon {
  if (subject.length === 0 || clip.length < 3) return [];
  const area = signedArea(computation, clip);
  if (isDegeneratePolygon(computation, clip)) return [];
  const windingSign = area > 0 ? 1 : -1;
  let output = [...subject];

  for (let clipIndex = 0; clipIndex < clip.length; clipIndex += 1) {
    const clipStart = clip[clipIndex]!;
    const clipEnd = clip[(clipIndex + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;

    let previous = input[input.length - 1]!;
    let previousInside = insideHalfPlane(computation, previous, clipStart, clipEnd, windingSign);
    for (const current of input) {
      const currentInside = insideHalfPlane(computation, current, clipStart, clipEnd, windingSign);
      if (currentInside) {
        if (!previousInside) {
          output.push(
            segmentLineIntersection(computation, previous, current, clipStart, clipEnd, current),
          );
        }
        output.push(current);
      } else if (previousInside) {
        output.push(
          segmentLineIntersection(computation, previous, current, clipStart, clipEnd, previous),
        );
      }
      previous = current;
      previousInside = currentInside;
    }
  }

  return output;
}

function polygonsIntersectValue(computation: Computation, left: Polygon, right: Polygon): boolean {
  const leftBounds = polygonBounds(left);
  const rightBounds = polygonBounds(right);
  if (leftBounds === null || rightBounds === null || !boundsIntersect(leftBounds, rightBounds)) {
    return false;
  }

  if (!isDegeneratePolygon(computation, left) && !isDegeneratePolygon(computation, right)) {
    return clipConvexPolygonValue(computation, left, right).length > 0;
  }
  if (left.some((point) => pointInConvexPolygon(computation, point, right))) return true;
  if (right.some((point) => pointInConvexPolygon(computation, point, left))) return true;

  const leftSegments = polygonSegments(left);
  const rightSegments = polygonSegments(right);
  return leftSegments.some(([leftStart, leftEnd]) =>
    rightSegments.some(([rightStart, rightEnd]) =>
      segmentsIntersect(computation, leftStart, leftEnd, rightStart, rightEnd),
    ),
  );
}

export function rectanglePolygon(x: number, y: number, width: number, height: number): Polygon {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

export function polygonBounds(polygon: Polygon): Bounds | null {
  if (polygon.length === 0) return null;
  let minX = polygon[0]!.x;
  let minY = polygon[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let index = 1; index < polygon.length; index += 1) {
    const point = polygon[index]!;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function boundsIntersect(left: Bounds, right: Bounds): boolean {
  const epsilon = tolerance([
    left.minX,
    left.minY,
    left.maxX,
    left.maxY,
    right.minX,
    right.minY,
    right.maxX,
    right.maxY,
  ]);
  return (
    left.maxX >= right.minX - epsilon &&
    right.maxX >= left.minX - epsilon &&
    left.maxY >= right.minY - epsilon &&
    right.maxY >= left.minY - epsilon
  );
}

export function clipConvexPolygon(subject: Polygon, clip: Polygon, path: string): Result<Polygon> {
  const computation: Computation = { path, overflowed: false };
  validatePolygon(computation, subject);
  validatePolygon(computation, clip);
  if (computation.overflowed) return failure(path);
  return finish(computation, clipConvexPolygonValue(computation, subject, clip));
}

export function polygonsIntersect(left: Polygon, right: Polygon, path: string): Result<boolean> {
  const computation: Computation = { path, overflowed: false };
  validatePolygon(computation, left);
  validatePolygon(computation, right);
  if (computation.overflowed) return failure(path);
  return finish(computation, polygonsIntersectValue(computation, left, right));
}

export function ellipseIntersectsPolygon(
  localQuery: Polygon,
  width: number,
  height: number,
  localExpansion: number,
  path: string,
): Result<boolean> {
  const computation: Computation = { path, overflowed: false };
  validatePolygon(computation, localQuery);
  checked(computation, width);
  checked(computation, height);
  checked(computation, localExpansion);
  if (computation.overflowed) return failure(path);
  if (localQuery.length === 0) return { ok: true, value: false };

  const centerX = checked(computation, width / 2);
  const centerY = checked(computation, height / 2);
  const expansion = Math.max(0, localExpansion);
  const radiusX = checked(computation, centerX + expansion);
  const radiusY = checked(computation, centerY + expansion);
  const center = { x: centerX, y: centerY };

  if (radiusX === 0 || radiusY === 0) {
    const silhouette: Polygon =
      radiusX === 0 && radiusY === 0
        ? [center]
        : radiusX === 0
          ? [
              { x: centerX, y: checked(computation, centerY - radiusY) },
              { x: centerX, y: checked(computation, centerY + radiusY) },
            ]
          : [
              { x: checked(computation, centerX - radiusX), y: centerY },
              { x: checked(computation, centerX + radiusX), y: centerY },
            ];
    return finish(computation, polygonsIntersectValue(computation, localQuery, silhouette));
  }

  const normalizedEquation = (point: GeometryPoint): number => {
    const offsetX = checked(computation, point.x - center.x);
    const offsetY = checked(computation, point.y - center.y);
    const x = checked(computation, offsetX / radiusX);
    const y = checked(computation, offsetY / radiusY);
    const xSquared = checked(computation, x * x);
    const ySquared = checked(computation, y * y);
    return checked(computation, xSquared + ySquared);
  };
  const hasContainedVertex = localQuery.some((point) => {
    const value = normalizedEquation(point);
    return value <= 1 + checkedTolerance(computation, [value]);
  });
  if (hasContainedVertex) return finish(computation, true);
  if (pointInConvexPolygon(computation, center, localQuery)) return finish(computation, true);

  const hasSegmentRoot = polygonSegments(localQuery).some(([start, end]) => {
    const startOffsetX = checked(computation, start.x - center.x);
    const startOffsetY = checked(computation, start.y - center.y);
    const segmentX = checked(computation, end.x - start.x);
    const segmentY = checked(computation, end.y - start.y);
    const startX = checked(computation, startOffsetX / radiusX);
    const startY = checked(computation, startOffsetY / radiusY);
    const deltaX = checked(computation, segmentX / radiusX);
    const deltaY = checked(computation, segmentY / radiusY);
    const deltaXSquared = checked(computation, deltaX * deltaX);
    const deltaYSquared = checked(computation, deltaY * deltaY);
    const quadratic = checked(computation, deltaXSquared + deltaYSquared);
    const startDeltaX = checked(computation, startX * deltaX);
    const startDeltaY = checked(computation, startY * deltaY);
    const linear = checked(computation, 2 * checked(computation, startDeltaX + startDeltaY));
    const startXSquared = checked(computation, startX * startX);
    const startYSquared = checked(computation, startY * startY);
    const constant = checked(computation, checked(computation, startXSquared + startYSquared) - 1);
    const coefficientTolerance = checkedTolerance(computation, [quadratic, linear, constant]);
    if (quadratic <= coefficientTolerance) return false;
    const linearSquared = checked(computation, linear * linear);
    const quadraticConstant = checked(computation, 4 * checked(computation, quadratic * constant));
    const discriminant = checked(computation, linearSquared - quadraticConstant);
    const discriminantTolerance = checkedTolerance(computation, [
      linearSquared,
      quadraticConstant,
      discriminant,
    ]);
    if (discriminant < -discriminantTolerance) return false;
    const squareRoot = checked(computation, Math.sqrt(Math.max(0, discriminant)));
    const denominator = checked(computation, 2 * quadratic);
    const roots = [
      checked(computation, (-linear - squareRoot) / denominator),
      checked(computation, (-linear + squareRoot) / denominator),
    ];
    return roots.some((root) => {
      const rootTolerance = checkedTolerance(computation, [root]);
      return root >= -rootTolerance && root <= 1 + rootTolerance;
    });
  });
  return finish(computation, hasSegmentRoot);
}

export function localStrokeExpansion(strokeWidth: number | null): number {
  return strokeWidth === null ? 0 : Math.max(0, strokeWidth) / 2;
}

export function transformPoint(
  matrix: Matrix,
  point: GeometryPoint,
  path: string,
): Result<GeometryPoint> {
  const x = matrix[0] * point.x + matrix[2] * point.y + matrix[4];
  const y = matrix[1] * point.x + matrix[3] * point.y + matrix[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return failure(path);
  return { ok: true, value: { x, y } };
}

export function transformPolygon(matrix: Matrix, polygon: Polygon, path: string): Result<Polygon> {
  const transformed: GeometryPoint[] = [];
  for (const point of polygon) {
    const result = transformPoint(matrix, point, path);
    if (!result.ok) return result;
    transformed.push(result.value);
  }
  return { ok: true, value: transformed };
}

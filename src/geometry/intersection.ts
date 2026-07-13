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

function tolerance(values: readonly number[]): number {
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  return GEOMETRY_EPSILON * scale;
}

function cross(start: GeometryPoint, end: GeometryPoint, point: GeometryPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function signedArea(polygon: Polygon): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function isDegeneratePolygon(polygon: Polygon): boolean {
  const area = signedArea(polygon);
  const areaEpsilon = tolerance(polygon.flatMap((point) => [point.x, point.y, area]));
  return Math.abs(area) <= areaEpsilon;
}

function insideHalfPlane(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
  windingSign: number,
): boolean {
  const value = cross(start, end, point) * windingSign;
  return value >= -tolerance([start.x, start.y, end.x, end.y, point.x, point.y, value]);
}

function segmentLineIntersection(
  start: GeometryPoint,
  end: GeometryPoint,
  clipStart: GeometryPoint,
  clipEnd: GeometryPoint,
  acceptedEndpoint: GeometryPoint,
): GeometryPoint {
  const subjectX = end.x - start.x;
  const subjectY = end.y - start.y;
  const clipX = clipEnd.x - clipStart.x;
  const clipY = clipEnd.y - clipStart.y;
  const denominator = subjectX * clipY - subjectY * clipX;
  const epsilon = tolerance([
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
    return pointOnSegment(start, clipStart, clipEnd) ? start : acceptedEndpoint;
  }
  if (Math.abs(denominator) <= epsilon) return acceptedEndpoint;

  const offsetX = clipStart.x - start.x;
  const offsetY = clipStart.y - start.y;
  const parameter = (offsetX * clipY - offsetY * clipX) / denominator;
  return { x: start.x + parameter * subjectX, y: start.y + parameter * subjectY };
}

function pointsEqual(left: GeometryPoint, right: GeometryPoint): boolean {
  const epsilon = tolerance([left.x, left.y, right.x, right.y]);
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function pointOnSegment(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint): boolean {
  if (pointsEqual(start, end)) return pointsEqual(point, start);
  const crossProduct = cross(start, end, point);
  const epsilon = tolerance([start.x, start.y, end.x, end.y, point.x, point.y, crossProduct]);
  return (
    Math.abs(crossProduct) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

function pointInConvexPolygon(point: GeometryPoint, polygon: Polygon): boolean {
  if (polygon.length === 0) return false;
  if (polygon.length === 1) return pointsEqual(point, polygon[0]!);
  if (polygon.length === 2) return pointOnSegment(point, polygon[0]!, polygon[1]!);

  const area = signedArea(polygon);
  if (isDegeneratePolygon(polygon)) {
    return polygon.some((start, index) =>
      pointOnSegment(point, start, polygon[(index + 1) % polygon.length]!),
    );
  }
  const windingSign = area > 0 ? 1 : -1;
  return polygon.every((start, index) =>
    insideHalfPlane(point, start, polygon[(index + 1) % polygon.length]!, windingSign),
  );
}

function segmentsIntersect(
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
): boolean {
  if (
    pointOnSegment(leftStart, rightStart, rightEnd) ||
    pointOnSegment(leftEnd, rightStart, rightEnd) ||
    pointOnSegment(rightStart, leftStart, leftEnd) ||
    pointOnSegment(rightEnd, leftStart, leftEnd)
  ) {
    return true;
  }

  const leftCrossStart = cross(leftStart, leftEnd, rightStart);
  const leftCrossEnd = cross(leftStart, leftEnd, rightEnd);
  const rightCrossStart = cross(rightStart, rightEnd, leftStart);
  const rightCrossEnd = cross(rightStart, rightEnd, leftEnd);
  return leftCrossStart * leftCrossEnd < 0 && rightCrossStart * rightCrossEnd < 0;
}

function polygonSegments(polygon: Polygon): readonly (readonly [GeometryPoint, GeometryPoint])[] {
  if (polygon.length < 2) return [];
  if (polygon.length === 2) return [[polygon[0]!, polygon[1]!]];
  return polygon.map((start, index) => [start, polygon[(index + 1) % polygon.length]!] as const);
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

export function clipConvexPolygon(subject: Polygon, clip: Polygon): Polygon {
  if (subject.length === 0 || clip.length < 3) return [];
  const area = signedArea(clip);
  if (isDegeneratePolygon(clip)) return [];
  const windingSign = area > 0 ? 1 : -1;
  let output = [...subject];

  for (let clipIndex = 0; clipIndex < clip.length; clipIndex += 1) {
    const clipStart = clip[clipIndex]!;
    const clipEnd = clip[(clipIndex + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;

    let previous = input[input.length - 1]!;
    let previousInside = insideHalfPlane(previous, clipStart, clipEnd, windingSign);
    for (const current of input) {
      const currentInside = insideHalfPlane(current, clipStart, clipEnd, windingSign);
      if (currentInside) {
        if (!previousInside) {
          output.push(segmentLineIntersection(previous, current, clipStart, clipEnd, current));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(segmentLineIntersection(previous, current, clipStart, clipEnd, previous));
      }
      previous = current;
      previousInside = currentInside;
    }
  }

  return output;
}

export function polygonsIntersect(left: Polygon, right: Polygon): boolean {
  const leftBounds = polygonBounds(left);
  const rightBounds = polygonBounds(right);
  if (leftBounds === null || rightBounds === null || !boundsIntersect(leftBounds, rightBounds)) {
    return false;
  }

  if (!isDegeneratePolygon(left) && !isDegeneratePolygon(right)) {
    return clipConvexPolygon(left, right).length > 0;
  }
  if (left.some((point) => pointInConvexPolygon(point, right))) return true;
  if (right.some((point) => pointInConvexPolygon(point, left))) return true;

  const leftSegments = polygonSegments(left);
  const rightSegments = polygonSegments(right);
  return leftSegments.some(([leftStart, leftEnd]) =>
    rightSegments.some(([rightStart, rightEnd]) =>
      segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd),
    ),
  );
}

export function ellipseIntersectsPolygon(
  localQuery: Polygon,
  width: number,
  height: number,
): boolean {
  if (localQuery.length === 0) return false;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const center = { x: radiusX, y: radiusY };

  if (radiusX === 0 || radiusY === 0) {
    const silhouette: Polygon =
      radiusX === 0 && radiusY === 0
        ? [center]
        : radiusX === 0
          ? [
              { x: 0, y: 0 },
              { x: 0, y: height },
            ]
          : [
              { x: 0, y: 0 },
              { x: width, y: 0 },
            ];
    return polygonsIntersect(localQuery, silhouette);
  }

  const normalizedEquation = (point: GeometryPoint): number => {
    const x = (point.x - center.x) / radiusX;
    const y = (point.y - center.y) / radiusY;
    return x * x + y * y;
  };
  if (
    localQuery.some((point) => {
      const value = normalizedEquation(point);
      return value <= 1 + tolerance([value]);
    })
  ) {
    return true;
  }
  if (pointInConvexPolygon(center, localQuery)) return true;

  return polygonSegments(localQuery).some(([start, end]) => {
    const startX = (start.x - center.x) / radiusX;
    const startY = (start.y - center.y) / radiusY;
    const deltaX = (end.x - start.x) / radiusX;
    const deltaY = (end.y - start.y) / radiusY;
    const quadratic = deltaX * deltaX + deltaY * deltaY;
    const linear = 2 * (startX * deltaX + startY * deltaY);
    const constant = startX * startX + startY * startY - 1;
    const coefficientTolerance = tolerance([quadratic, linear, constant]);
    if (quadratic <= coefficientTolerance) return false;
    const discriminant = linear * linear - 4 * quadratic * constant;
    const discriminantTolerance = tolerance([
      linear * linear,
      4 * quadratic * constant,
      discriminant,
    ]);
    if (discriminant < -discriminantTolerance) return false;
    const squareRoot = Math.sqrt(Math.max(0, discriminant));
    const roots = [
      (-linear - squareRoot) / (2 * quadratic),
      (-linear + squareRoot) / (2 * quadratic),
    ];
    return roots.some((root) => {
      const rootTolerance = tolerance([root]);
      return root >= -rootTolerance && root <= 1 + rootTolerance;
    });
  });
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
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: { code: 'geometry.computation-overflow', path } };
  }
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

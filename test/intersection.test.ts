import { expect, test } from 'bun:test';
import {
  boundsIntersect,
  clipConvexPolygon,
  ellipseIntersectsPolygon,
  localStrokeExpansion,
  polygonBounds,
  polygonsIntersect,
  rectanglePolygon,
  transformPoint,
  transformPolygon,
} from '../src/geometry/intersection';
import { invertMatrix } from '../src/geometry/matrix';

test('clips a marquee against a rotated convex frame', () => {
  const clipped = clipConvexPolygon(rectanglePolygon(0, 0, 20, 20), [
    { x: 10, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 10 },
  ]);

  expect(clipped.length).toBeGreaterThanOrEqual(4);
  expect(polygonBounds(clipped)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
});

test('clips convex polygons independently of winding direction', () => {
  const subject = rectanglePolygon(-5, 5, 20, 10);
  const clockwiseClip = [
    { x: 10, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 20 },
    { x: 10, y: 20 },
  ];
  const counterClockwiseClip = [...clockwiseClip].reverse();

  expect(polygonBounds(clipConvexPolygon(subject, clockwiseClip))).toEqual({
    minX: 0,
    minY: 5,
    maxX: 10,
    maxY: 15,
  });
  expect(polygonBounds(clipConvexPolygon(subject, counterClockwiseClip))).toEqual({
    minX: 0,
    minY: 5,
    maxX: 10,
    maxY: 15,
  });
});

test('treats point, line, edge, and corner contact as polygon intersections', () => {
  const box = rectanglePolygon(0, 0, 10, 10);

  expect(polygonsIntersect([{ x: 5, y: 5 }], box)).toBe(true);
  expect(polygonsIntersect([{ x: 15, y: 5 }], box)).toBe(false);
  expect(
    polygonsIntersect(
      [
        { x: -5, y: 5 },
        { x: 0, y: 5 },
      ],
      box,
    ),
  ).toBe(true);
  expect(polygonsIntersect(rectanglePolygon(-2, -2, 2, 2), box)).toBe(true);
  expect(polygonsIntersect(rectanglePolygon(10, 2, 3, 3), box)).toBe(true);
  expect(polygonBounds(clipConvexPolygon([{ x: 5, y: 5 }], box))).toEqual({
    minX: 5,
    minY: 5,
    maxX: 5,
    maxY: 5,
  });
  expect(
    polygonBounds(
      clipConvexPolygon(
        [
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ],
        box,
      ),
    ),
  ).toEqual({ minX: 0, minY: 5, maxX: 10, maxY: 5 });
  expect(
    polygonBounds(
      clipConvexPolygon(
        [
          { x: -5, y: 0 },
          { x: 15, y: 0 },
        ],
        box,
      ),
    ),
  ).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
});

test('rejects convex polygons whose bounds overlap without exact contact', () => {
  const lowerLeft = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
  ];
  const upperRight = [
    { x: 2, y: 2 },
    { x: 2, y: 1.5 },
    { x: 1.5, y: 2 },
  ];

  expect(boundsIntersect(polygonBounds(lowerLeft)!, polygonBounds(upperRight)!)).toBe(true);
  expect(polygonsIntersect(lowerLeft, upperRight)).toBe(false);
});

test('uses scale-relative tolerance without accepting a visible schema-maximum gap', () => {
  const nearMaximum = rectanglePolygon(9_999_900, 9_999_900, 10, 10);
  const tangent = rectanglePolygon(9_999_910, 9_999_900, 10, 10);
  const separated = rectanglePolygon(9_999_910.1, 9_999_900, 10, 10);

  expect(polygonsIntersect(nearMaximum, tangent)).toBe(true);
  expect(boundsIntersect(polygonBounds(nearMaximum)!, polygonBounds(separated)!)).toBe(false);
  expect(polygonsIntersect(nearMaximum, separated)).toBe(false);
});

test('transforms geometry and reports computed affine overflow at the supplied path', () => {
  expect(transformPoint([2, 0, 0, 3, 10, 20], { x: 4, y: 5 }, '/shape')).toEqual({
    ok: true,
    value: { x: 18, y: 35 },
  });
  expect(
    transformPolygon(
      [1, 0, 0, 1, 2, 3],
      [
        { x: 0, y: 0 },
        { x: 4, y: 5 },
      ],
      '/shape',
    ),
  ).toEqual({
    ok: true,
    value: [
      { x: 2, y: 3 },
      { x: 6, y: 8 },
    ],
  });
  expect(
    transformPoint(
      [Number.MAX_VALUE, 0, 0, 1, Number.MAX_VALUE, 0],
      { x: Number.MAX_VALUE, y: 0 },
      '/nodes/2/transform',
    ),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/2/transform' },
  });
  expect(
    transformPolygon(
      [Number.MAX_VALUE, 0, 0, 1, Number.MAX_VALUE, 0],
      [
        { x: 0, y: 0 },
        { x: Number.MAX_VALUE, y: 0 },
      ],
      '/nodes/3/transform',
    ),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/3/transform' },
  });
});

test('rejects singular matrix inversion through the existing matrix contract', () => {
  expect(invertMatrix([1, 0, 0, 0, 12, 18], '/nodes/4/transform')).toEqual({
    ok: false,
    error: { code: 'matrix.singular', path: '/nodes/4/transform' },
  });
});

test('expands centered strokes in local space', () => {
  const expansion = localStrokeExpansion(6);

  expect(localStrokeExpansion(null)).toBe(0);
  expect(expansion).toBe(3);
  expect(rectanglePolygon(-expansion, -expansion, 10 + 2 * expansion, 10 + 2 * expansion)).toEqual([
    { x: -3, y: -3 },
    { x: 13, y: -3 },
    { x: 13, y: 13 },
    { x: -3, y: 13 },
  ]);
});

test('rejects an ellipse corner miss but accepts tangent contact', () => {
  expect(ellipseIntersectsPolygon(rectanglePolygon(9, 9, 1, 1), 10, 10)).toBe(false);
  expect(ellipseIntersectsPolygon(rectanglePolygon(10, 4, 1, 2), 10, 10)).toBe(true);
});

test('detects ellipse containment and roots along a query segment', () => {
  expect(ellipseIntersectsPolygon(rectanglePolygon(-5, -5, 20, 20), 10, 10)).toBe(true);
  expect(ellipseIntersectsPolygon(rectanglePolygon(4, 4, 1, 1), 10, 10)).toBe(true);
  expect(
    ellipseIntersectsPolygon(
      [
        { x: -2, y: 5 },
        { x: 12, y: 5 },
      ],
      10,
      10,
    ),
  ).toBe(true);
  expect(
    ellipseIntersectsPolygon(
      [
        { x: -2, y: 11 },
        { x: 12, y: 11 },
      ],
      10,
      10,
    ),
  ).toBe(false);
});

test('handles zero-width, zero-height, and point ellipse silhouettes inclusively', () => {
  expect(
    ellipseIntersectsPolygon(
      [
        { x: -1, y: 5 },
        { x: 1, y: 5 },
      ],
      0,
      10,
    ),
  ).toBe(true);
  expect(
    ellipseIntersectsPolygon(
      [
        { x: 1, y: 4 },
        { x: 1, y: 6 },
      ],
      0,
      10,
    ),
  ).toBe(false);
  expect(ellipseIntersectsPolygon([{ x: 0, y: 0 }], 0, 0)).toBe(true);
  expect(ellipseIntersectsPolygon([{ x: 0.01, y: 0 }], 0, 0)).toBe(false);
  expect(
    ellipseIntersectsPolygon(
      [
        { x: 5, y: -1 },
        { x: 5, y: 1 },
      ],
      10,
      0,
    ),
  ).toBe(true);
});

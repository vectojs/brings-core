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
import type { Result } from '../src/document/types';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function expectIntersection(result: Result<boolean>, expected: boolean): void {
  expect(result).toEqual({ ok: true, value: expected });
}

test('clips a marquee against a rotated convex frame', () => {
  const clipped = unwrap(
    clipConvexPolygon(
      rectanglePolygon(0, 0, 20, 20),
      [
        { x: 10, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 20 },
        { x: 0, y: 10 },
      ],
      '/query',
    ),
  );

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

  expect(polygonBounds(unwrap(clipConvexPolygon(subject, clockwiseClip, '/query')))).toEqual({
    minX: 0,
    minY: 5,
    maxX: 10,
    maxY: 15,
  });
  expect(polygonBounds(unwrap(clipConvexPolygon(subject, counterClockwiseClip, '/query')))).toEqual(
    {
      minX: 0,
      minY: 5,
      maxX: 10,
      maxY: 15,
    },
  );
});

test('treats point, line, edge, and corner contact as polygon intersections', () => {
  const box = rectanglePolygon(0, 0, 10, 10);

  expectIntersection(polygonsIntersect([{ x: 5, y: 5 }], box, '/query'), true);
  expectIntersection(polygonsIntersect([{ x: 15, y: 5 }], box, '/query'), false);
  expectIntersection(
    polygonsIntersect(
      [
        { x: -5, y: 5 },
        { x: 0, y: 5 },
      ],
      box,
      '/query',
    ),
    true,
  );
  expectIntersection(polygonsIntersect(rectanglePolygon(-2, -2, 2, 2), box, '/query'), true);
  expectIntersection(polygonsIntersect(rectanglePolygon(10, 2, 3, 3), box, '/query'), true);
  expect(polygonBounds(unwrap(clipConvexPolygon([{ x: 5, y: 5 }], box, '/query')))).toEqual({
    minX: 5,
    minY: 5,
    maxX: 5,
    maxY: 5,
  });
  expect(
    polygonBounds(
      unwrap(
        clipConvexPolygon(
          [
            { x: -5, y: 5 },
            { x: 15, y: 5 },
          ],
          box,
          '/query',
        ),
      ),
    ),
  ).toEqual({ minX: 0, minY: 5, maxX: 10, maxY: 5 });
  expect(
    polygonBounds(
      unwrap(
        clipConvexPolygon(
          [
            { x: -5, y: 0 },
            { x: 15, y: 0 },
          ],
          box,
          '/query',
        ),
      ),
    ),
  ).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
});

test('intersects degenerate rectangle polygons independently of operand order', () => {
  const box = rectanglePolygon(0, 0, 10, 10);
  const zeroWidth = rectanglePolygon(5, -5, 0, 20);
  const zeroHeight = rectanglePolygon(-5, 5, 20, 0);
  const point = rectanglePolygon(5, 5, 0, 0);

  for (const degenerate of [zeroWidth, zeroHeight, point]) {
    expectIntersection(polygonsIntersect(degenerate, box, '/query'), true);
    expectIntersection(polygonsIntersect(box, degenerate, '/query'), true);
  }
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
  expectIntersection(polygonsIntersect(lowerLeft, upperRight, '/query'), false);
});

test('uses scale-relative tolerance without accepting a visible schema-maximum gap', () => {
  const nearMaximum = rectanglePolygon(9_999_900, 9_999_900, 10, 10);
  const tangent = rectanglePolygon(9_999_910, 9_999_900, 10, 10);
  const separated = rectanglePolygon(9_999_910.1, 9_999_900, 10, 10);

  expectIntersection(polygonsIntersect(nearMaximum, tangent, '/query'), true);
  expect(boundsIntersect(polygonBounds(nearMaximum)!, polygonBounds(separated)!)).toBe(false);
  expectIntersection(polygonsIntersect(nearMaximum, separated, '/query'), false);
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
  expectIntersection(
    ellipseIntersectsPolygon(rectanglePolygon(9, 9, 1, 1), 10, 10, 0, '/query'),
    false,
  );
  expectIntersection(
    ellipseIntersectsPolygon(rectanglePolygon(10, 4, 1, 2), 10, 10, 0, '/query'),
    true,
  );
});

test('detects ellipse containment and roots along a query segment', () => {
  expectIntersection(
    ellipseIntersectsPolygon(rectanglePolygon(-5, -5, 20, 20), 10, 10, 0, '/query'),
    true,
  );
  expectIntersection(
    ellipseIntersectsPolygon(rectanglePolygon(4, 4, 1, 1), 10, 10, 0, '/query'),
    true,
  );
  expectIntersection(
    ellipseIntersectsPolygon(
      [
        { x: -2, y: 5 },
        { x: 12, y: 5 },
      ],
      10,
      10,
      0,
      '/query',
    ),
    true,
  );
  expectIntersection(
    ellipseIntersectsPolygon(
      [
        { x: -2, y: 11 },
        { x: 12, y: 11 },
      ],
      10,
      10,
      0,
      '/query',
    ),
    false,
  );
});

test('handles zero-width, zero-height, and point ellipse silhouettes inclusively', () => {
  expectIntersection(
    ellipseIntersectsPolygon(
      [
        { x: -1, y: 5 },
        { x: 1, y: 5 },
      ],
      0,
      10,
      0,
      '/query',
    ),
    true,
  );
  expectIntersection(
    ellipseIntersectsPolygon(
      [
        { x: 1, y: 4 },
        { x: 1, y: 6 },
      ],
      0,
      10,
      0,
      '/query',
    ),
    false,
  );
  expectIntersection(ellipseIntersectsPolygon([{ x: 0, y: 0 }], 0, 0, 0, '/query'), true);
  expectIntersection(ellipseIntersectsPolygon([{ x: 0.01, y: 0 }], 0, 0, 0, '/query'), false);
  expectIntersection(
    ellipseIntersectsPolygon(
      [
        { x: 5, y: -1 },
        { x: 5, y: 1 },
      ],
      10,
      0,
      0,
      '/query',
    ),
    true,
  );
});

test('reports finite polygon arithmetic overflow instead of corrupting containment', () => {
  const huge = [
    { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE },
    { x: Number.MAX_VALUE, y: -Number.MAX_VALUE },
    { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
    { x: -Number.MAX_VALUE, y: Number.MAX_VALUE },
  ];

  expect(polygonsIntersect(huge, [{ x: 0, y: 0 }], '/nodes/8/transform')).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/8/transform' },
  });
  expect(clipConvexPolygon(rectanglePolygon(-1, -1, 2, 2), huge, '/nodes/8/clip')).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/8/clip' },
  });
});

test('reports finite ellipse arithmetic overflow instead of a false hit', () => {
  expect(
    ellipseIntersectsPolygon(
      [{ x: Number.MAX_VALUE, y: Number.MAX_VALUE }],
      10,
      10,
      0,
      '/nodes/9/transform',
    ),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/9/transform' },
  });
});

test('expands ellipse stroke radii around the original center', () => {
  const expansion = localStrokeExpansion(4);
  const boundaries = [
    { tangent: { x: -2, y: 3 }, outside: { x: -2.1, y: 3 } },
    { tangent: { x: 12, y: 3 }, outside: { x: 12.1, y: 3 } },
    { tangent: { x: 5, y: -2 }, outside: { x: 5, y: -2.1 } },
    { tangent: { x: 5, y: 8 }, outside: { x: 5, y: 8.1 } },
  ];

  for (const { tangent, outside } of boundaries) {
    expect(ellipseIntersectsPolygon([tangent], 10, 6, expansion, '/nodes/10/transform')).toEqual({
      ok: true,
      value: true,
    });
    expect(ellipseIntersectsPolygon([outside], 10, 6, expansion, '/nodes/10/transform')).toEqual({
      ok: true,
      value: false,
    });
  }
});

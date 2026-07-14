import { expect, test } from 'bun:test';
import type { Matrix, RectangleNode, SceneNodeInput } from '../src';
import { prepareSelectionCandidate, preparedCandidateIntersects } from '../src/geometry/hitShared';
import { rectanglePolygon } from '../src/geometry/intersection';
import { FIXTURE_IDS, validatedDocument } from './fixtures';

const paint = { type: 'solid', r: 0, g: 0, b: 0, a: 1 } as const;

function validatedNode(input: SceneNodeInput) {
  return validatedDocument([input], [input.id]).nodes[0]!;
}

function rectangleNode(overrides: Record<string, unknown> = {}): RectangleNode {
  const input = {
    id: FIXTURE_IDS.rectangle,
    type: 'rectangle',
    name: 'Rectangle',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 10,
    height: 20,
    cornerRadii: [0, 0, 0, 0],
    fill: paint,
    stroke: null,
    ...overrides,
  } as SceneNodeInput;
  return validatedNode(input) as RectangleNode;
}

test('prepares selectable silhouettes without document traversal', () => {
  const pageMatrix: Matrix = [2, 0.5, 0, 3, 40, 60];
  const rectangle = prepareSelectionCandidate(
    rectangleNode({ stroke: { paint, width: 4 } }),
    pageMatrix,
    0,
  );
  expect(rectangle.ok).toBe(true);
  if (!rectangle.ok || rectangle.value === null) return;
  expect(rectangle.value.pageBounds).toEqual({ minX: 36, minY: 53, maxX: 64, maxY: 132 });
  expect(rectangle.value.silhouette.kind).toBe('polygon');
  expect(Object.isFrozen(rectangle.value.silhouette)).toBe(true);
  if (rectangle.value.silhouette.kind === 'polygon') {
    expect(Object.isFrozen(rectangle.value.silhouette.pagePolygon)).toBe(true);
    expect(rectangle.value.silhouette.pagePolygon.every(Object.isFrozen)).toBe(true);
  }
  expect(preparedCandidateIntersects(rectangle.value, rectanglePolygon(36, 57, 1, 1))).toEqual({
    ok: true,
    value: true,
  });

  const groupInput = {
    id: FIXTURE_IDS.frame,
    type: 'group',
    name: 'Group',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [FIXTURE_IDS.rectangle],
  } as SceneNodeInput;
  const groupDocument = validatedDocument(
    [groupInput, { ...rectangleNode(), parentId: FIXTURE_IDS.frame }],
    [FIXTURE_IDS.frame],
  );
  expect(prepareSelectionCandidate(groupDocument.nodes[0]!, pageMatrix, 0)).toEqual({
    ok: true,
    value: null,
  });
});

test('preserves centered ellipse strokes and measured text boxes', () => {
  const ellipse = validatedNode({
    id: FIXTURE_IDS.ellipse,
    type: 'ellipse',
    name: 'Ellipse',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 20,
    height: 10,
    fill: paint,
    stroke: { paint, width: 4 },
  });
  const preparedEllipse = prepareSelectionCandidate(ellipse, ellipse.transform, 0);
  expect(preparedEllipse.ok).toBe(true);
  if (!preparedEllipse.ok || preparedEllipse.value === null) return;
  expect(preparedEllipse.value.pageBounds).toEqual({ minX: -2, minY: -2, maxX: 22, maxY: 12 });
  expect(preparedCandidateIntersects(preparedEllipse.value, rectanglePolygon(-2, 5, 0, 0))).toEqual(
    { ok: true, value: true },
  );
  expect(preparedCandidateIntersects(preparedEllipse.value, rectanglePolygon(22, 5, 0, 0))).toEqual(
    { ok: true, value: true },
  );

  const text = validatedNode({
    id: FIXTURE_IDS.text,
    type: 'text',
    name: 'Text',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 10, 15],
    content: 'Brings',
    fontFamilies: ['sans-serif'],
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 20,
    horizontalAlign: 'left',
    layoutMode: 'fixedBox',
    width: 80,
    height: 20,
    fill: paint,
  });
  const preparedText = prepareSelectionCandidate(text, text.transform, 1);
  expect(preparedText.ok).toBe(true);
  if (!preparedText.ok || preparedText.value === null) return;
  expect(preparedText.value.pageBounds).toEqual({ minX: 10, minY: 15, maxX: 90, maxY: 35 });
  expect(preparedCandidateIntersects(preparedText.value, rectanglePolygon(90, 35, 0, 0))).toEqual({
    ok: true,
    value: true,
  });
  expect(preparedCandidateIntersects(preparedText.value, rectanglePolygon(91, 35, 0, 0))).toEqual({
    ok: true,
    value: false,
  });
});

test('detaches and freezes prepared ellipse geometry from mutable source aliases', () => {
  const ellipse = validatedNode({
    id: FIXTURE_IDS.ellipse,
    type: 'ellipse',
    name: 'Ellipse',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 20,
    height: 10,
    fill: paint,
    stroke: { paint, width: 4 },
  });
  const pageMatrix = [2, 0.5, 0.5, 1.5, 40, 30] as unknown as Matrix;
  const prepared = prepareSelectionCandidate(ellipse, pageMatrix, 2);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok || prepared.value === null) return;

  const point = rectanglePolygon(62.5, 42.5, 0, 0);
  expect(preparedCandidateIntersects(prepared.value, point)).toEqual({ ok: true, value: true });

  const mutableEllipse = ellipse as unknown as {
    width: number;
    height: number;
    stroke: { width: number } | null;
  };
  mutableEllipse.width = 1;
  mutableEllipse.height = 1;
  if (mutableEllipse.stroke !== null) mutableEllipse.stroke.width = 0;
  const mutablePageMatrix = pageMatrix as unknown as number[];
  mutablePageMatrix[0] = 1;
  mutablePageMatrix[1] = 0;
  mutablePageMatrix[2] = 0;
  mutablePageMatrix[3] = 1;
  mutablePageMatrix[4] = 1_000;
  mutablePageMatrix[5] = 1_000;

  expect(preparedCandidateIntersects(prepared.value, point)).toEqual({ ok: true, value: true });
  expect(Object.isFrozen(prepared.value)).toBe(true);
  expect('node' in prepared.value).toBe(false);
  expect('pageMatrix' in prepared.value).toBe(false);
  expect(Object.isFrozen(prepared.value.pageBounds)).toBe(true);
  expect(prepared.value.silhouette.kind).toBe('ellipse');
  expect(Object.isFrozen(prepared.value.silhouette)).toBe(true);
  if (prepared.value.silhouette.kind === 'ellipse') {
    expect(Object.isFrozen(prepared.value.silhouette.pageMatrix)).toBe(true);
  }
});

test('evaluates affine sheared ellipses through the prepared seam', () => {
  const ellipse = validatedNode({
    id: FIXTURE_IDS.ellipse,
    type: 'ellipse',
    name: 'Ellipse',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 20,
    height: 10,
    fill: paint,
    stroke: null,
  });
  const prepared = prepareSelectionCandidate(ellipse, [2, 0.5, 0.5, 1.5, 40, 30], 3);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok || prepared.value === null) return;

  expect(preparedCandidateIntersects(prepared.value, rectanglePolygon(62.5, 42.5, 0, 0))).toEqual({
    ok: true,
    value: true,
  });
  expect(preparedCandidateIntersects(prepared.value, rectanglePolygon(84, 31, 0, 0))).toEqual({
    ok: true,
    value: false,
  });
});

test('reports transformed silhouette overflow at the node transform path', () => {
  const overflowingMatrix: Matrix = [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 0, 0];
  expect(prepareSelectionCandidate(rectangleNode(), overflowingMatrix, 7)).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/7/transform' },
  });
});

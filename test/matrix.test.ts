import { expect, test } from 'bun:test';
import { validateDocument } from '../src';
import { invertMatrix, multiplyMatrices, pageMatrixForNode } from '../src/geometry/matrix';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page: '22222222-2222-4222-8222-222222222222',
  frame: '33333333-3333-4333-8333-333333333333',
  rectangle: '44444444-4444-4444-8444-444444444444',
} as const;

function documentFixture() {
  const result = validateDocument({
    id: ids.document,
    revision: 0,
    name: 'Geometry',
    pageOrder: [ids.page],
    activePageId: ids.page,
    pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [ids.frame] }],
    nodes: [
      {
        id: ids.frame,
        type: 'frame',
        name: 'Frame',
        parentId: null,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [2, 0, 0, 2, 100, 50],
        childIds: [ids.rectangle],
        width: 400,
        height: 300,
        cornerRadii: [0, 0, 0, 0],
        background: null,
        stroke: null,
        clipChildren: false,
      },
      {
        id: ids.rectangle,
        type: 'rectangle',
        name: 'Rectangle',
        parentId: ids.frame,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 20, 30],
        width: 120,
        height: 80,
        cornerRadii: [0, 0, 0, 0],
        fill: null,
        stroke: null,
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

test('multiplies affine matrices in column-vector composition order', () => {
  expect(multiplyMatrices([1, 0, 0, 1, 10, 20], [2, 0, 0, 3, 4, 5])).toEqual([2, 0, 0, 3, 14, 25]);
});

test('inverts a finite affine matrix and rejects a singular matrix', () => {
  const matrix = [2, 0, 0, 4, 10, 20] as const;
  const inverse = invertMatrix(matrix, '/delta');
  expect(inverse).toEqual({ ok: true, value: [0.5, -0, -0, 0.25, -5, -5] });
  if (inverse.ok) {
    expect(multiplyMatrices(matrix, inverse.value)).toEqual([1, 0, 0, 1, 0, 0]);
  }
  expect(invertMatrix([1, 0, 0, 0, 0, 0], '/delta')).toEqual({
    ok: false,
    error: { code: 'matrix.singular', path: '/delta' },
  });
});

test('derives a nested node page matrix without retaining caller state', () => {
  const document = documentFixture();
  const result = pageMatrixForNode(document, ids.rectangle, '/nodeId');

  expect(result).toEqual({ ok: true, value: [2, 0, 0, 2, 140, 110] });
  if (!result.ok) return;
  (result.value as unknown as number[])[4] = 999;
  expect(document.nodes[1]?.transform).toEqual([1, 0, 0, 1, 20, 30]);
  expect(pageMatrixForNode(document, ids.document, '/nodeId')).toEqual({
    ok: false,
    error: { code: 'node.not-found', path: '/nodeId' },
  });
});

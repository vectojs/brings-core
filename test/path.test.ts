import { expect, test } from 'bun:test';
import {
  createPageHitIndex,
  flattenPathNetwork,
  hitTestPage,
  intersectPageRect,
  pathNetworkBounds,
  validateDocument,
  type BringsDocument,
  type Matrix,
  type NodeId,
  type PathNetwork,
  type SceneNodeInput,
} from '../src';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page: '22222222-2222-4222-8222-222222222222',
  path: '33333333-3333-4333-8333-333333333333' as NodeId,
  frame: '44444444-4444-4444-8444-444444444444' as NodeId,
  vertexA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  vertexB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  vertexC: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  vertexD: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  vertexE: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  vertexF: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  vertexG: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
  vertexH: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
  segmentA: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  segmentB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  segmentC: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  segmentD: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
  segmentE: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
  segmentF: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
  segmentG: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
  segmentH: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8',
} as const;

const paint = { type: 'solid', r: 0.1, g: 0.4, b: 0.8, a: 1 } as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function cubicNetwork(): object {
  return {
    vertices: [
      { id: ids.vertexA, position: { x: 0, y: 0 } },
      { id: ids.vertexB, position: { x: 100, y: 0 } },
    ],
    segments: [
      {
        id: ids.segmentA,
        startVertexId: ids.vertexA,
        endVertexId: ids.vertexB,
        startControl: { x: 0, y: 100 },
        endControl: { x: 0, y: 100 },
      },
    ],
  };
}

function triangleNetwork(): object {
  return {
    vertices: [
      { id: ids.vertexA, position: { x: 0, y: 0 } },
      { id: ids.vertexB, position: { x: 100, y: 0 } },
      { id: ids.vertexC, position: { x: 50, y: 100 } },
    ],
    segments: [
      {
        id: ids.segmentA,
        startVertexId: ids.vertexA,
        endVertexId: ids.vertexB,
        startControl: { x: 0, y: 0 },
        endControl: { x: 0, y: 0 },
      },
      {
        id: ids.segmentB,
        startVertexId: ids.vertexB,
        endVertexId: ids.vertexC,
        startControl: { x: 0, y: 0 },
        endControl: { x: 0, y: 0 },
      },
      {
        id: ids.segmentC,
        startVertexId: ids.vertexC,
        endVertexId: ids.vertexA,
        startControl: { x: 0, y: 0 },
        endControl: { x: 0, y: 0 },
      },
    ],
  };
}

function ringsNetwork(): object {
  const line = (id: string, startVertexId: string, endVertexId: string) => ({
    id,
    startVertexId,
    endVertexId,
    startControl: { x: 0, y: 0 },
    endControl: { x: 0, y: 0 },
  });
  return {
    vertices: [
      { id: ids.vertexA, position: { x: 0, y: 0 } },
      { id: ids.vertexB, position: { x: 100, y: 0 } },
      { id: ids.vertexC, position: { x: 100, y: 100 } },
      { id: ids.vertexD, position: { x: 0, y: 100 } },
      { id: ids.vertexE, position: { x: 30, y: 30 } },
      { id: ids.vertexF, position: { x: 70, y: 30 } },
      { id: ids.vertexG, position: { x: 70, y: 70 } },
      { id: ids.vertexH, position: { x: 30, y: 70 } },
    ],
    segments: [
      line(ids.segmentA, ids.vertexA, ids.vertexB),
      line(ids.segmentB, ids.vertexB, ids.vertexC),
      line(ids.segmentC, ids.vertexC, ids.vertexD),
      line(ids.segmentD, ids.vertexD, ids.vertexA),
      line(ids.segmentE, ids.vertexE, ids.vertexF),
      line(ids.segmentF, ids.vertexF, ids.vertexG),
      line(ids.segmentG, ids.vertexG, ids.vertexH),
      line(ids.segmentH, ids.vertexH, ids.vertexE),
    ],
  };
}

function documentWithPath(
  network: object,
  overrides: Record<string, unknown> = {},
): BringsDocument {
  return unwrap(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Path fixture',
      pageOrder: [ids.page],
      activePageId: ids.page,
      pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [ids.path] }],
      nodes: [
        {
          id: ids.path,
          type: 'path',
          name: 'Path',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          network,
          fillRule: 'nonzero',
          fill: null,
          stroke: { paint, width: 4 },
          ...overrides,
        } as SceneNodeInput,
      ],
    }),
  );
}

function networkOf(document: BringsDocument): PathNetwork {
  const node = document.nodes[0];
  if (node?.type !== 'path') throw new Error('Expected a Path node.');
  return node.network;
}

test('computes true cubic extrema instead of control-point bounds', () => {
  const network = networkOf(documentWithPath(cubicNetwork()));
  expect(pathNetworkBounds(network, [1, 0, 0, 1, 0, 0], '/network')).toEqual({
    ok: true,
    value: { minX: 0, minY: 0, maxX: 100, maxY: 75 },
  });
  expect(pathNetworkBounds(network, [2, 0, 0, 3, 10, 20], '/network')).toEqual({
    ok: true,
    value: { minX: 10, minY: 20, maxX: 210, maxY: 245 },
  });
});

test('adaptively flattens detached open and closed components', () => {
  const open = flattenPathNetwork(networkOf(documentWithPath(cubicNetwork())), 0.25, '/network');
  expect(open.ok).toBe(true);
  if (!open.ok) return;
  expect(open.value).toHaveLength(1);
  expect(open.value[0]?.closed).toBe(false);
  expect(open.value[0]?.points[0]).toEqual({ x: 0, y: 0 });
  expect(open.value[0]?.points.at(-1)).toEqual({ x: 100, y: 0 });
  expect((open.value[0]?.points.length ?? 0) > 4).toBe(true);
  expect(Object.isFrozen(open.value)).toBe(true);
  expect(Object.isFrozen(open.value[0]?.points)).toBe(true);

  const closed = flattenPathNetwork(
    networkOf(documentWithPath(triangleNetwork(), { fill: paint, stroke: null })),
    0.25,
    '/network',
  );
  expect(closed.ok).toBe(true);
  if (!closed.ok) return;
  const component = closed.value[0];
  expect(component?.closed).toBe(true);
  if (component === undefined) return;
  expect(component.points[0]).toEqual(component.points.at(-1)!);

  expect(
    flattenPathNetwork(networkOf(documentWithPath(cubicNetwork())), Number.MIN_VALUE, '/network'),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.path-complexity', path: '/network' },
  });
});

test('hits open cubic strokes and closed fills through affine transforms', () => {
  const open = documentWithPath(cubicNetwork());
  expect(hitTestPage(open, { x: 50, y: 75 })).toEqual([ids.path]);
  expect(hitTestPage(open, { x: 50, y: 77 })).toEqual([ids.path]);
  expect(hitTestPage(open, { x: 50, y: 78 })).toEqual([]);
  expect(intersectPageRect(open, { x: 48, y: 73, width: 4, height: 4 })).toEqual({
    ok: true,
    value: [ids.path],
  });

  const closed = documentWithPath(triangleNetwork(), { fill: paint, stroke: null });
  expect(hitTestPage(closed, { x: 50, y: 30 })).toEqual([ids.path]);
  expect(hitTestPage(closed, { x: 90, y: 80 })).toEqual([]);

  const transformed = documentWithPath(cubicNetwork(), {
    transform: [2, 0, 0, 2, 10, 20],
  });
  expect(hitTestPage(transformed, { x: 110, y: 170 })).toEqual([ids.path]);
  expect(hitTestPage(transformed, { x: 110, y: 177 })).toEqual([]);
});

test('honors compound fill rules and transformed Frame clipping', () => {
  const evenOdd = documentWithPath(ringsNetwork(), {
    fill: paint,
    stroke: null,
    fillRule: 'evenodd',
  });
  const nonzero = documentWithPath(ringsNetwork(), {
    fill: paint,
    stroke: null,
    fillRule: 'nonzero',
  });
  expect(hitTestPage(evenOdd, { x: 50, y: 50 })).toEqual([]);
  expect(hitTestPage(nonzero, { x: 50, y: 50 })).toEqual([ids.path]);

  const clipped = unwrap(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Clipped Path',
      pageOrder: [ids.page],
      activePageId: ids.page,
      pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [ids.frame] }],
      nodes: [
        {
          id: ids.frame,
          type: 'frame',
          name: 'Clip',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 10, 20],
          childIds: [ids.path],
          width: 60,
          height: 100,
          cornerRadii: [0, 0, 0, 0],
          background: null,
          stroke: null,
          clipChildren: true,
        },
        {
          id: ids.path,
          type: 'path',
          name: 'Path',
          parentId: ids.frame,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          network: triangleNetwork(),
          fillRule: 'nonzero',
          fill: paint,
          stroke: null,
        },
      ],
    }),
  );
  expect(hitTestPage(clipped, { x: 60, y: 50 })).toContain(ids.path);
  expect(hitTestPage(clipped, { x: 90, y: 40 })).toEqual([]);
});

test('keeps direct and PageHitIndex Path queries in parity', () => {
  const document = documentWithPath(triangleNetwork(), { fill: paint, stroke: null });
  const index = unwrap(createPageHitIndex(document));
  const rectangles = [
    { x: 50, y: 30, width: 0, height: 0 },
    { x: 90, y: 80, width: 0, height: 0 },
    { x: -10, y: -10, width: 120, height: 120 },
  ];
  for (const rectangle of rectangles) {
    expect(index.intersect(rectangle)).toEqual(intersectPageRect(document, rectangle));
    expect(index.hitTest({ x: rectangle.x, y: rectangle.y })).toEqual(
      hitTestPage(document, { x: rectangle.x, y: rectangle.y }),
    );
  }
});

test('reports transformed Path overflow at the supplied geometry path', () => {
  const network = networkOf(documentWithPath(cubicNetwork()));
  const matrix: Matrix = [Number.MAX_VALUE, 0, 0, 1, 0, 0];
  expect(pathNetworkBounds(network, matrix, '/nodes/0/transform')).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/0/transform' },
  });
});

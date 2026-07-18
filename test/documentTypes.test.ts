import { expect, test } from 'bun:test';
import { createDocument, validateDocument, type DocumentCommandInput } from '../src';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page: '22222222-2222-4222-8222-222222222222',
  frame: '33333333-3333-4333-8333-333333333333',
  rectangle: '44444444-4444-4444-8444-444444444444',
  otherPage: '55555555-5555-4555-8555-555555555555',
  group: '66666666-6666-4666-8666-666666666666',
  path: '77777777-7777-4777-8777-777777777777',
  vertexA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  vertexB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  vertexC: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  vertexD: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  segmentA: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  segmentB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  segmentC: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
} as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function frameNode(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.frame,
    type: 'frame',
    name: 'Frame',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [ids.rectangle],
    width: 400,
    height: 300,
    cornerRadii: [0, 0, 0, 0],
    background: null,
    stroke: null,
    clipChildren: false,
    ...overrides,
  };
}

function rectangleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.rectangle,
    type: 'rectangle',
    name: 'Rectangle',
    parentId: ids.frame,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 20, 20],
    width: 120,
    height: 80,
    cornerRadii: [0, 0, 0, 0],
    fill: { type: 'solid', r: 0, g: 0.5, b: 1, a: 1 },
    stroke: null,
    ...overrides,
  };
}

function closedPathNetwork() {
  return {
    vertices: [
      { id: ids.vertexA, position: { x: 0, y: 0 } },
      { id: ids.vertexB, position: { x: 120, y: 0 } },
      { id: ids.vertexC, position: { x: 60, y: 90 } },
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

function pathNode(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.path,
    type: 'path',
    name: 'Path',
    parentId: ids.frame,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 20, 20],
    network: closedPathNetwork(),
    fillRule: 'nonzero',
    fill: { type: 'solid', r: 0.2, g: 0.45, b: 1, a: 1 },
    stroke: null,
    ...overrides,
  };
}

function documentWithNodes(nodes: readonly unknown[]) {
  return {
    id: ids.document,
    revision: 0,
    name: 'Untitled',
    pageOrder: [ids.page],
    activePageId: ids.page,
    pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [ids.frame] }],
    nodes,
  };
}

test('creates one revision-zero active page from raw caller UUIDs', () => {
  const document = unwrap(
    createDocument({
      id: ids.document,
      name: 'Untitled',
      initialPage: { id: ids.page, name: 'Page 1' },
    }),
  );

  expect(document).toMatchObject({
    id: ids.document,
    revision: 0,
    pageOrder: [ids.page],
    activePageId: ids.page,
    pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [] }],
    nodes: [],
  });
});

test('returns a JSON Pointer error for malformed public input', () => {
  expect(
    createDocument({
      id: 'not-a-uuid',
      name: 'Untitled',
      initialPage: { id: ids.page, name: 'Page 1' },
    }),
  ).toEqual({
    ok: false,
    error: { code: 'id.invalid', path: '/id' },
  });
});

test('rejects a leaf with childIds without mutating supplied input', () => {
  const invalid = {
    ...documentWithNodes([rectangleNode({ parentId: null, childIds: [] })]),
    pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [ids.rectangle] }],
  };
  const before = JSON.stringify(invalid);

  expect(validateDocument(invalid)).toEqual({
    ok: false,
    error: { code: 'node.leaf-children', path: '/nodes/0/childIds' },
  });
  expect(JSON.stringify(invalid)).toBe(before);
});

test('accepts canonical Frame and Rectangle values', () => {
  const result = validateDocument(documentWithNodes([frameNode(), rectangleNode()]));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.nodes.map((node) => node.id as string)).toEqual([ids.frame, ids.rectangle]);
});

test('accepts and detaches a canonical closed Path network', () => {
  const input = pathNode();
  const result = validateDocument(documentWithNodes([frameNode({ childIds: [ids.path] }), input]));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const path = result.value.nodes[1];
  expect(path?.type).toBe('path');
  if (path?.type !== 'path') return;
  expect(path.network.vertices).toHaveLength(3);
  expect(path.network.segments).toHaveLength(3);

  input.network.vertices[0]!.position.x = 500;
  expect(path.network.vertices[0]!.position.x).toBe(0);
});

test('accepts a detached open cubic Path chain without a fill', () => {
  const network = closedPathNetwork();
  network.segments.pop();
  network.segments[0]!.startControl = { x: 35, y: 45 };
  network.segments[0]!.endControl = { x: -30, y: 20 };

  const result = validateDocument(
    documentWithNodes([frameNode({ childIds: [ids.path] }), pathNode({ network, fill: null })]),
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const path = result.value.nodes[1];
  expect(path?.type === 'path' ? path.network.segments[0]?.startControl : null).toEqual({
    x: 35,
    y: 45,
  });
});

test('rejects malformed Path identities and endpoints at stable pointers', () => {
  const duplicateVertex = closedPathNetwork();
  duplicateVertex.vertices[1]!.id = ids.vertexA;
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: duplicateVertex }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.vertex-duplicate', path: '/nodes/1/network/vertices/1/id' },
  });

  const danglingSegment = closedPathNetwork();
  (danglingSegment.segments[0] as { endVertexId: string }).endVertexId = ids.vertexD;
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: danglingSegment }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.vertex-missing', path: '/nodes/1/network/segments/0/endVertexId' },
  });

  const selfEdge = closedPathNetwork();
  selfEdge.segments[0]!.endVertexId = ids.vertexA;
  expect(
    validateDocument(
      documentWithNodes([frameNode({ childIds: [ids.path] }), pathNode({ network: selfEdge })]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.self-edge', path: '/nodes/1/network/segments/0/endVertexId' },
  });

  const invalidControl = closedPathNetwork();
  invalidControl.segments[0]!.startControl.x = Number.NaN;
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: invalidControl }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: {
      code: 'number.finite',
      path: '/nodes/1/network/segments/0/startControl/x',
    },
  });

  const duplicateSegmentId = closedPathNetwork();
  duplicateSegmentId.segments[1]!.id = ids.segmentA;
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: duplicateSegmentId }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.segment-duplicate', path: '/nodes/1/network/segments/1/id' },
  });

  const duplicateEdge = closedPathNetwork();
  duplicateEdge.segments[1]!.startVertexId = ids.vertexB;
  duplicateEdge.segments[1]!.endVertexId = ids.vertexA;
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: duplicateEdge }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.edge-duplicate', path: '/nodes/1/network/segments/1' },
  });
});

test('rejects branching Path networks and fills on open components', () => {
  const branchingNetwork = {
    vertices: [
      { id: ids.vertexA, position: { x: 0, y: 0 } },
      { id: ids.vertexB, position: { x: 100, y: 0 } },
      { id: ids.vertexC, position: { x: 0, y: 100 } },
      { id: ids.vertexD, position: { x: -100, y: 0 } },
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
        startVertexId: ids.vertexA,
        endVertexId: ids.vertexC,
        startControl: { x: 0, y: 0 },
        endControl: { x: 0, y: 0 },
      },
      {
        id: ids.segmentC,
        startVertexId: ids.vertexA,
        endVertexId: ids.vertexD,
        startControl: { x: 0, y: 0 },
        endControl: { x: 0, y: 0 },
      },
    ],
  };
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: branchingNetwork, fill: null }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.branching-unsupported', path: '/nodes/1/network/segments/2' },
  });

  const openNetwork = closedPathNetwork();
  openNetwork.segments.pop();
  expect(
    validateDocument(
      documentWithNodes([frameNode({ childIds: [ids.path] }), pathNode({ network: openNetwork })]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.fill-open', path: '/nodes/1/fill' },
  });

  const isolatedVertex = closedPathNetwork();
  isolatedVertex.segments.pop();
  isolatedVertex.segments.pop();
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({ network: isolatedVertex, fill: null }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.component-invalid', path: '/nodes/1/network/vertices/2' },
  });

  expect(
    validateDocument(
      documentWithNodes([
        frameNode({ childIds: [ids.path] }),
        pathNode({
          network: {
            vertices: Array.from({ length: 10_001 }, () => ({
              id: ids.vertexA,
              position: { x: 0, y: 0 },
            })),
            segments: closedPathNetwork().segments,
          },
          fill: null,
        }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'path.vertices-limit', path: '/nodes/1/network/vertices' },
  });
});

test('rejects invalid scalar, matrix, and paint values at stable pointers', () => {
  expect(validateDocument(documentWithNodes([frameNode({ opacity: 2 }), rectangleNode()]))).toEqual(
    {
      ok: false,
      error: { code: 'number.range', path: '/nodes/0/opacity' },
    },
  );
  expect(
    validateDocument(
      documentWithNodes([frameNode({ transform: [1, 0, 0, 0, 0, 0] }), rectangleNode()]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'matrix.singular', path: '/nodes/0/transform' },
  });
  expect(
    validateDocument(
      documentWithNodes([
        frameNode(),
        rectangleNode({ fill: { type: 'solid', r: 1.1, g: 0, b: 0, a: 1 } }),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'number.range', path: '/nodes/1/fill/r' },
  });
  expect(
    validateDocument(documentWithNodes([frameNode({ width: 10_000_001 }), rectangleNode()])),
  ).toEqual({
    ok: false,
    error: { code: 'number.range', path: '/nodes/0/width' },
  });
  expect(
    validateDocument(
      documentWithNodes([frameNode({ transform: [Number.NaN, 0, 0, 1, 0, 0] }), rectangleNode()]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'matrix.invalid', path: '/nodes/0/transform/0' },
  });
});

test('rejects a finite matrix whose determinant overflows', () => {
  expect(
    validateDocument(
      documentWithNodes([
        frameNode({
          transform: [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 0, 0],
        }),
        rectangleNode(),
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'matrix.computation-overflow', path: '/nodes/0/transform' },
  });
});

test('rejects page sequence and active-page violations', () => {
  expect(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Untitled',
      pageOrder: [ids.page],
      activePageId: ids.otherPage,
      pages: [
        { id: ids.page, name: 'Page 1', rootNodeIds: [] },
        { id: ids.otherPage, name: 'Extra page', rootNodeIds: [] },
      ],
      nodes: [],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'page.order', path: '/pages/1/id' },
  });
  expect(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Untitled',
      pageOrder: [ids.page],
      activePageId: ids.otherPage,
      pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [] }],
      nodes: [],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'page.active-not-found', path: '/activePageId' },
  });
});

test('rejects noncanonical node array order before exposing a document', () => {
  expect(validateDocument(documentWithNodes([rectangleNode(), frameNode()]))).toEqual({
    ok: false,
    error: { code: 'node.order', path: '/nodes/0/id' },
  });
});

test('rejects invalid identity, container, and topology values', () => {
  expect(
    validateDocument(documentWithNodes([frameNode({ id: ids.page }), rectangleNode()])),
  ).toEqual({
    ok: false,
    error: { code: 'id.duplicate', path: '/nodes/0/id' },
  });
  expect(
    validateDocument(
      documentWithNodes([
        {
          id: ids.frame,
          type: 'group',
          name: 'Empty Group',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [],
        },
      ]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'node.group-empty', path: '/nodes/0/childIds' },
  });
  expect(
    validateDocument(
      documentWithNodes([frameNode({ childIds: ['99999999-9999-4999-8999-999999999999'] })]),
    ),
  ).toEqual({
    ok: false,
    error: { code: 'node.dangling', path: '/nodes/0/childIds/0' },
  });
  expect(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Untitled',
      pageOrder: [ids.page],
      activePageId: ids.page,
      pages: [{ id: ids.page, name: 'Page 1', rootNodeIds: [] }],
      nodes: [
        frameNode({ parentId: ids.rectangle, childIds: [ids.rectangle] }),
        frameNode({
          id: ids.rectangle,
          name: 'Nested frame',
          parentId: ids.frame,
          childIds: [ids.frame],
        }),
      ],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'node.cycle', path: '/nodes/0/id' },
  });
});

test('uses strict lowercase UUIDs and returns a detached valid snapshot', () => {
  expect(
    createDocument({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
      name: 'Untitled',
      initialPage: { id: ids.page, name: 'Page 1' },
    }),
  ).toEqual({
    ok: false,
    error: { code: 'id.invalid', path: '/id' },
  });

  const input = documentWithNodes([frameNode(), rectangleNode()]);
  const document = unwrap(validateDocument(input));
  (input.nodes[0] as { name: string }).name = 'Mutated caller value';
  expect(document.nodes[0]?.name).toBe('Frame');
  (document.nodes[0] as { name: string }).name = 'Mutated returned value';
  expect((input.nodes[0] as { name: string }).name).toBe('Mutated caller value');
});

test('publishes JSON-compatible layer and property command inputs', () => {
  const commands: readonly DocumentCommandInput[] = [
    {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { opacity: 0.5 },
    },
    {
      kind: 'move-nodes',
      nodeIds: [ids.rectangle],
      pageId: ids.page,
      parentId: null,
      index: 0,
    },
    {
      kind: 'group-nodes',
      nodeIds: [ids.rectangle],
      group: { id: ids.group, name: 'Group' },
    },
    { kind: 'ungroup-node', nodeId: ids.group },
    {
      kind: 'create-path',
      pageId: ids.page,
      parentId: ids.frame,
      index: 0,
      path: {
        id: ids.path,
        name: 'Path',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 0, 0],
        network: closedPathNetwork(),
        fillRule: 'nonzero',
        fill: null,
        stroke: null,
      },
    },
    { kind: 'set-path-network', nodeId: ids.path, network: closedPathNetwork() },
  ];

  expect(commands.map((command) => command.kind)).toEqual([
    'set-node-properties',
    'move-nodes',
    'group-nodes',
    'ungroup-node',
    'create-path',
    'set-path-network',
  ]);
});

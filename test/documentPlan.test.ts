import { expect, test } from 'bun:test';
import {
  createDocument,
  validateDocument,
  type BringsDocument,
  type DocumentContent,
} from '../src';
import { planCommand } from '../src/document/plan';
import { pageMatrixForNode } from '../src/geometry/matrix';
import type { FrameNodeInput } from '../src/document/types';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page1: '22222222-2222-4222-8222-222222222222',
  page2: '33333333-3333-4333-8333-333333333333',
  page3: '44444444-4444-4444-8444-444444444444',
  frame: '55555555-5555-4555-8555-555555555555',
  rectangle: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
  child: '88888888-8888-4888-8888-888888888888',
  nestedGroup: '99999999-9999-4999-8999-999999999999',
  sibling: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  emptyGroup: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  createdText: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ellipse: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  path: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  vertexA: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  vertexB: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  vertexC: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  segmentA: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  segmentB: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  segmentC: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
} as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function initialDocument() {
  return unwrap(
    createDocument({
      id: ids.document,
      name: 'Untitled',
      initialPage: { id: ids.page1, name: 'Page 1' },
    }),
  );
}

function propertyDocument() {
  return unwrap(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Untitled',
      pageOrder: [ids.page1],
      activePageId: ids.page1,
      pages: [
        {
          id: ids.page1,
          name: 'Page 1',
          rootNodeIds: [ids.frame, ids.group, ids.sibling],
        },
      ],
      nodes: [
        {
          id: ids.frame,
          type: 'frame',
          name: 'Frame',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 10, 20],
          childIds: [ids.rectangle],
          width: 400,
          height: 300,
          cornerRadii: [0, 0, 0, 0],
          background: { type: 'solid', r: 1, g: 1, b: 1, a: 1 },
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
          transform: [1, 0, 0, 1, 20, 20],
          width: 120,
          height: 80,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid', r: 0, g: 0.5, b: 1, a: 1 },
          stroke: null,
        },
        {
          id: ids.group,
          type: 'group',
          name: 'Group',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 320, 40],
          childIds: [ids.child],
        },
        {
          id: ids.child,
          type: 'ellipse',
          name: 'Ellipse',
          parentId: ids.group,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 16, 24],
          width: 90,
          height: 60,
          fill: { type: 'solid', r: 0.9, g: 0.2, b: 0.3, a: 1 },
          stroke: null,
        },
        {
          id: ids.sibling,
          type: 'text',
          name: 'Text',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 80, 360],
          content: 'Hello',
          fontFamilies: ['Inter'],
          fontWeight: 400,
          fontSize: 16,
          lineHeight: 24,
          horizontalAlign: 'left',
          layoutMode: 'fixedBox',
          width: 180,
          height: 48,
          fill: { type: 'solid', r: 0.1, g: 0.1, b: 0.1, a: 1 },
        },
      ],
    }),
  );
}

function documentFromContent(before: BringsDocument, content: DocumentContent, revision: number) {
  return unwrap(validateDocument({ id: before.id, revision, ...content }));
}

function frameCommand(pageId: string = ids.page1) {
  return {
    kind: 'insert-subtree' as const,
    pageId,
    parentId: null,
    index: 0,
    rootId: ids.frame,
    nodes: [
      {
        id: ids.frame,
        type: 'frame' as const,
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
      },
      {
        id: ids.rectangle,
        type: 'rectangle' as const,
        name: 'Rectangle',
        parentId: ids.frame,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 20, 20],
        width: 120,
        height: 80,
        cornerRadii: [0, 0, 0, 0],
        fill: { type: 'solid' as const, r: 0, g: 0.5, b: 1, a: 1 },
        stroke: null,
      },
    ],
  };
}

function createFrameCommand() {
  return {
    kind: 'create-frame' as const,
    pageId: ids.page1,
    parentId: null,
    index: 0,
    frame: {
      id: ids.frame,
      name: 'Frame',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 40, 60],
      width: 400,
      height: 300,
      cornerRadii: [0, 0, 0, 0],
      background: null,
      stroke: null,
      clipChildren: false,
    },
  };
}

function createRectangleCommand(parentId: string = ids.frame) {
  return {
    kind: 'create-rectangle' as const,
    pageId: ids.page1,
    parentId,
    index: 0,
    rectangle: {
      id: ids.rectangle,
      name: 'Rectangle',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 20, 20],
      width: 120,
      height: 80,
      cornerRadii: [0, 0, 0, 0],
      fill: { type: 'solid' as const, r: 0, g: 0.5, b: 1, a: 1 },
      stroke: null,
    },
  };
}

function createEllipseCommand(parentId: string = ids.frame) {
  return {
    kind: 'create-ellipse' as const,
    pageId: ids.page1,
    parentId,
    index: 0,
    ellipse: {
      id: ids.ellipse,
      name: 'Ellipse',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 24, 28],
      width: 120,
      height: 120,
      fill: { type: 'solid' as const, r: 0.18, g: 0.45, b: 0.95, a: 1 },
      stroke: {
        paint: { type: 'solid' as const, r: 0.08, g: 0.12, b: 0.2, a: 1 },
        width: 2,
      },
    },
  };
}

function createTextCommand() {
  return {
    kind: 'create-text' as const,
    pageId: ids.page1,
    parentId: null,
    index: 0,
    text: {
      id: ids.createdText,
      name: 'Heading',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 40, 60],
      content: 'Hello Brings',
      fontFamilies: ['Inter', 'system-ui'],
      fontWeight: 600,
      fontSize: 24,
      lineHeight: 32,
      horizontalAlign: 'left' as const,
      layoutMode: 'fixedBox' as const,
      width: 260,
      height: 40,
      fill: { type: 'solid' as const, r: 0.1, g: 0.1, b: 0.1, a: 1 },
    },
  };
}

function pathNetwork(offset = 0) {
  return {
    vertices: [
      { id: ids.vertexA, position: { x: offset, y: 0 } },
      { id: ids.vertexB, position: { x: 120 + offset, y: 0 } },
      { id: ids.vertexC, position: { x: 60 + offset, y: 90 } },
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

function createPathCommand(parentId: string | null = ids.frame) {
  return {
    kind: 'create-path' as const,
    pageId: ids.page1,
    parentId,
    index: 0,
    path: {
      id: ids.path,
      name: 'Path',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 24, 28],
      network: pathNetwork(),
      fillRule: 'nonzero' as const,
      fill: { type: 'solid' as const, r: 0.18, g: 0.45, b: 0.95, a: 1 },
      stroke: null,
    },
  };
}

test('creates an empty Frame then a nested Rectangle through intention-level commands', () => {
  const frame = unwrap(planCommand(initialDocument(), createFrameCommand() as never));
  const afterFrame = documentFromContent(initialDocument(), frame, 1);
  const rectangle = planCommand(afterFrame, createRectangleCommand() as never);

  expect(rectangle).toMatchObject({
    ok: true,
    value: {
      pages: [{ rootNodeIds: [ids.frame] }],
      nodes: [
        { id: ids.frame, type: 'frame', childIds: [ids.rectangle] },
        { id: ids.rectangle, type: 'rectangle', parentId: ids.frame },
      ],
    },
  });
});

test('creates a detached nested Ellipse through an intention-level command', () => {
  const frame = unwrap(planCommand(initialDocument(), createFrameCommand() as never));
  const afterFrame = documentFromContent(initialDocument(), frame, 1);
  const command = createEllipseCommand();
  const result = planCommand(afterFrame, command as never);

  expect(result).toMatchObject({
    ok: true,
    value: {
      pages: [{ rootNodeIds: [ids.frame] }],
      nodes: [
        { id: ids.frame, type: 'frame', childIds: [ids.ellipse] },
        {
          id: ids.ellipse,
          type: 'ellipse',
          parentId: ids.frame,
          width: 120,
          height: 120,
        },
      ],
    },
  });
  command.ellipse.transform[4] = 999;
  command.ellipse.fill.r = 1;
  command.ellipse.stroke.paint.r = 1;
  if (!result.ok) return;
  expect(result.value.nodes[1]).toMatchObject({
    transform: [1, 0, 0, 1, 24, 28],
    fill: { r: 0.18 },
    stroke: { paint: { r: 0.08 } },
  });
});

test('creates a detached Text leaf with validated typography fields', () => {
  const command = createTextCommand();
  const result = planCommand(initialDocument(), command);

  expect(result).toMatchObject({
    ok: true,
    value: {
      pages: [{ rootNodeIds: [ids.createdText] }],
      nodes: [
        {
          id: ids.createdText,
          type: 'text',
          content: 'Hello Brings',
          fontFamilies: ['Inter', 'system-ui'],
          fontWeight: 600,
          fontSize: 24,
          lineHeight: 32,
        },
      ],
    },
  });
  command.text.fontFamilies[0] = 'Mutated';
  command.text.fill.r = 1;
  if (!result.ok) return;
  expect(result.value.nodes[0]).toMatchObject({
    fontFamilies: ['Inter', 'system-ui'],
    fill: { r: 0.1 },
  });
});

test('creates a detached nested Path through one intention-level command', () => {
  const frame = unwrap(planCommand(initialDocument(), createFrameCommand() as never));
  const afterFrame = documentFromContent(initialDocument(), frame, 1);
  const command = createPathCommand();
  const result = planCommand(afterFrame, command as never);

  expect(result).toMatchObject({
    ok: true,
    value: {
      nodes: [
        { id: ids.frame, childIds: [ids.path] },
        {
          id: ids.path,
          type: 'path',
          parentId: ids.frame,
        },
      ],
    },
  });
  command.path.network.vertices[0]!.position.x = 999;
  command.path.fill.r = 1;
  if (!result.ok || result.value.nodes[1]?.type !== 'path') return;
  expect(String(result.value.nodes[1].network.segments[0]?.id)).toBe(ids.segmentA);
  expect(result.value.nodes[1].network.vertices[0]?.position.x).toBe(0);
  expect(result.value.nodes[1].fill?.r).toBe(0.18);
});

test('replaces one Path network atomically with stable errors and no-change detection', () => {
  const created = unwrap(planCommand(initialDocument(), createPathCommand(null) as never));
  const before = documentFromContent(initialDocument(), created, 1);
  const command = { kind: 'set-path-network' as const, nodeId: ids.path, network: pathNetwork(12) };
  const result = planCommand(before, command as never);

  expect(result).toMatchObject({
    ok: true,
    value: { nodes: [{ type: 'path' }] },
  });
  command.network.vertices[0]!.position.x = 999;
  if (!result.ok || result.value.nodes[0]?.type !== 'path') return;
  expect(result.value.nodes[0].network.vertices[0]?.position.x).toBe(12);

  const after = documentFromContent(before, result.value, 2);
  expect(
    planCommand(after, {
      kind: 'set-path-network',
      nodeId: ids.path,
      network: pathNetwork(12),
    } as never),
  ).toEqual({ ok: false, error: { code: 'command.no-change', path: '/' } });

  const malformed = pathNetwork(20);
  (malformed.segments[0] as { endVertexId: string }).endVertexId = ids.frame;
  expect(
    planCommand(before, {
      kind: 'set-path-network',
      nodeId: ids.path,
      network: malformed,
    } as never),
  ).toEqual({
    ok: false,
    error: { code: 'path.vertex-missing', path: '/network/segments/0/endVertexId' },
  });
  expect(before.nodes[0]?.type).toBe('path');
  if (before.nodes[0]?.type !== 'path') return;
  expect(before.nodes[0].network.vertices[0]?.position.x).toBe(0);
});

test('patches Path paints while rejecting rectangle-only dimensions', () => {
  const created = unwrap(planCommand(initialDocument(), createPathCommand(null) as never));
  const before = documentFromContent(initialDocument(), created, 1);
  const command = {
    kind: 'set-node-properties' as const,
    nodeIds: [ids.path],
    patch: {
      fill: null,
      stroke: {
        paint: { type: 'solid' as const, r: 0.1, g: 0.2, b: 0.3, a: 1 },
        width: 3,
      },
    },
  };
  const result = planCommand(before, command);

  expect(result).toMatchObject({
    ok: true,
    value: { nodes: [{ type: 'path', fill: null, stroke: { width: 3 } }] },
  });
  command.patch.stroke.paint.r = 1;
  if (!result.ok || result.value.nodes[0]?.type !== 'path') return;
  expect(result.value.nodes[0].stroke?.paint.r).toBe(0.1);

  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.path],
      patch: { width: 100 },
    }),
  ).toEqual({
    ok: false,
    error: { code: 'command.property-unsupported', path: '/patch/width' },
  });
});

test('rejects Path authoring through locked, hidden, and inactive targets', () => {
  const created = unwrap(planCommand(initialDocument(), createPathCommand(null) as never));
  const before = documentFromContent(initialDocument(), created, 1);
  const replacement = {
    kind: 'set-path-network' as const,
    nodeId: ids.path,
    network: pathNetwork(12),
  };
  const locked = unwrap(
    validateDocument({
      ...before,
      nodes: before.nodes.map((node) => ({ ...node, locked: true })),
    }),
  );
  expect(planCommand(locked, replacement as never)).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/0/locked' },
  });
  const hidden = unwrap(
    validateDocument({
      ...before,
      nodes: before.nodes.map((node) => ({ ...node, visible: false })),
    }),
  );
  expect(planCommand(hidden, replacement as never)).toEqual({
    ok: false,
    error: { code: 'node.hidden', path: '/nodes/0/visible' },
  });
  const addedPage = unwrap(
    planCommand(before, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const inactive = documentFromContent(before, addedPage, 2);
  expect(planCommand(inactive, replacement as never)).toEqual({
    ok: false,
    error: { code: 'command.source-page-mismatch', path: '/nodeId' },
  });
});

test('keeps creation failures atomic for locked destinations and malformed geometry', () => {
  const frame = unwrap(planCommand(initialDocument(), createFrameCommand() as never));
  const afterFrame = documentFromContent(initialDocument(), frame, 1);
  const locked = {
    ...afterFrame,
    nodes: afterFrame.nodes.map((node) =>
      node.id === ids.frame ? { ...node, locked: true } : node,
    ),
  } as BringsDocument;
  const lockedResult = planCommand(locked, createRectangleCommand() as never);
  expect(lockedResult).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/0/locked' },
  });

  const malformed = createFrameCommand();
  malformed.frame.width = 0;
  const malformedResult = planCommand(initialDocument(), malformed as never);
  expect(malformedResult).toMatchObject({
    ok: false,
    error: { code: 'number.range', path: '/nodes/0/width' },
  });
});

test('creates an empty page, activates it, and preserves the old page', () => {
  const before = initialDocument();
  const result = planCommand(before, {
    kind: 'create-page',
    id: ids.page2,
    name: 'Page 2',
    index: 1,
  });

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) return;
  expect(result.value).toMatchObject({
    pageOrder: [ids.page1, ids.page2],
    activePageId: ids.page2,
    pages: [
      { id: ids.page1, rootNodeIds: [] },
      { id: ids.page2, name: 'Page 2', rootNodeIds: [] },
    ],
  });
});

test('inserts a detached Frame with a nested Rectangle without retaining caller values', () => {
  const command = frameCommand();
  const result = planCommand(initialDocument(), command);

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) return;
  expect(result.value.pages[0]?.rootNodeIds.map((nodeId) => nodeId as string)).toEqual([ids.frame]);
  expect(result.value.nodes.map((node) => node.id as string)).toEqual([ids.frame, ids.rectangle]);
  (command.nodes[0] as { name: string }).name = 'Mutated command';
  expect(result.value.nodes[0]?.name).toBe('Frame');
});

test('preserves existing creation transform and deletion planner contracts', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const afterInsert = documentFromContent(before, inserted, 1);
  const transformed = unwrap(
    planCommand(afterInsert, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.rectangle],
      delta: [1, 0, 0, 1, 8, -3],
    }),
  );
  const afterTransform = documentFromContent(afterInsert, transformed, 2);
  const deleted = unwrap(
    planCommand(afterTransform, { kind: 'delete-node', nodeId: ids.rectangle }),
  );

  expect(inserted).toMatchObject({
    pages: [{ rootNodeIds: [ids.frame] }],
    nodes: [
      { id: ids.frame, childIds: [ids.rectangle] },
      { id: ids.rectangle, transform: [1, 0, 0, 1, 20, 20] },
    ],
  });
  expect(transformed).toMatchObject({
    nodes: [{ id: ids.frame }, { id: ids.rectangle, transform: [1, 0, 0, 1, 28, 17] }],
  });
  expect(deleted).toMatchObject({
    pages: [{ rootNodeIds: [ids.frame] }],
    nodes: [{ id: ids.frame, childIds: [] }],
  });
});

test('applies type-compatible atomic node property patches without retaining caller values', () => {
  const before = propertyDocument();
  const paint = { type: 'solid' as const, r: 0.2, g: 0.4, b: 0.6, a: 0.8 };
  const stroke = { paint: { type: 'solid' as const, r: 0.8, g: 0.3, b: 0.1, a: 1 }, width: 3 };
  const frame = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.frame],
      patch: {
        name: 'Canvas',
        opacity: 0.75,
        width: 420,
        height: 280,
        cornerRadii: [12, 12, 12, 12],
        background: paint,
        stroke,
        clipChildren: true,
      },
    }),
  );
  const rectangle = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { width: 160, height: 96, cornerRadii: [8, 8, 8, 8], fill: null, stroke },
    }),
  );
  const ellipse = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.child],
      patch: { width: 120, height: 72, fill: paint, stroke },
    }),
  );
  const text = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.sibling],
      patch: {
        content: 'Updated',
        fontFamilies: ['Noto Sans', 'sans-serif'],
        fontWeight: 700,
        fontSize: 20,
        lineHeight: 28,
        horizontalAlign: 'center',
        layoutMode: 'autoWidth',
        width: 220,
        height: 56,
        fill: paint,
      },
    }),
  );
  const group = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.group],
      patch: { name: 'Organized', visible: false, locked: true, opacity: 0.5 },
    }),
  );

  expect(frame.nodes[0]).toMatchObject({
    name: 'Canvas',
    opacity: 0.75,
    width: 420,
    height: 280,
    cornerRadii: [12, 12, 12, 12],
    background: paint,
    stroke,
    clipChildren: true,
  });
  expect(rectangle.nodes[1]).toMatchObject({
    width: 160,
    height: 96,
    cornerRadii: [8, 8, 8, 8],
    fill: null,
    stroke,
  });
  expect(ellipse.nodes[3]).toMatchObject({ width: 120, height: 72, fill: paint, stroke });
  expect(text.nodes[4]).toMatchObject({
    content: 'Updated',
    fontFamilies: ['Noto Sans', 'sans-serif'],
    fontWeight: 700,
    fontSize: 20,
    lineHeight: 28,
    horizontalAlign: 'center',
    layoutMode: 'autoWidth',
    width: 220,
    height: 56,
    fill: paint,
  });
  expect(group.nodes[2]).toMatchObject({
    name: 'Organized',
    visible: false,
    locked: true,
    opacity: 0.5,
  });

  paint.r = 1;
  stroke.paint.g = 1;
  stroke.width = 99;
  expect(frame.nodes[0]).toMatchObject({
    background: { type: 'solid', r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
    stroke: { paint: { type: 'solid', r: 0.8, g: 0.3, b: 0.1, a: 1 }, width: 3 },
  });
});

test('rejects invalid, unsupported, locked, duplicate, and no-change property patches atomically', () => {
  const before = propertyDocument();
  const source = JSON.stringify(before);

  expect(
    planCommand(before, { kind: 'set-node-properties', nodeIds: [ids.rectangle], patch: {} }),
  ).toEqual({ ok: false, error: { code: 'command.patch-empty', path: '/patch' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { background: null },
    }),
  ).toEqual({
    ok: false,
    error: { code: 'command.property-unsupported', path: '/patch/background' },
  });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.sibling],
      patch: { fill: null },
    }),
  ).toEqual({ ok: false, error: { code: 'command.property-unsupported', path: '/patch/fill' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle, ids.rectangle],
      patch: { name: 'Card' },
    }),
  ).toEqual({ ok: false, error: { code: 'id.duplicate', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle, ids.sibling],
      patch: { fill: null },
    }),
  ).toEqual({ ok: false, error: { code: 'command.property-unsupported', path: '/patch/fill' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { opacity: 1 },
    }),
  ).toEqual({ ok: false, error: { code: 'command.no-change', path: '/' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { unknown: true } as never,
    }),
  ).toEqual({ ok: false, error: { code: 'field.unknown', path: '/patch' } });
  expect(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { cornerRadii: [80, 80, 80, 80] },
    }),
  ).toEqual({ ok: false, error: { code: 'number.range', path: '/patch/cornerRadii/0' } });

  const locked = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { locked: true },
    }),
  );
  const lockedDocument = documentFromContent(before, locked, 1);
  expect(
    planCommand(lockedDocument, {
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { name: 'Blocked' },
    }),
  ).toEqual({ ok: false, error: { code: 'node.locked', path: '/nodes/1/locked' } });
  const unlocked = planCommand(lockedDocument, {
    kind: 'set-node-properties',
    nodeIds: [ids.rectangle],
    patch: { locked: false },
  });
  expect(unlocked.ok).toBe(true);
  if (unlocked.ok) expect(unlocked.value.nodes[1]).toMatchObject({ locked: false });
  expect(JSON.stringify(before)).toBe(source);
});

test('moves canonical roots and reparents nodes while preserving page-space matrices', () => {
  const before = propertyDocument();
  const reorder = unwrap(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.sibling, ids.frame],
      pageId: ids.page1,
      parentId: null,
      index: 1,
    }),
  );
  expect(reorder.pages[0]?.rootNodeIds.map(String)).toEqual([ids.group, ids.frame, ids.sibling]);

  const beforeTextPage = unwrap(pageMatrixForNode(before, ids.sibling, '/nodeIds/0'));
  const movedText = unwrap(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.sibling],
      pageId: ids.page1,
      parentId: ids.frame,
      index: 1,
    }),
  );
  const textDocument = documentFromContent(before, movedText, 1);
  expect(pageMatrixForNode(textDocument, ids.sibling, '/nodeIds/0')).toEqual({
    ok: true,
    value: beforeTextPage,
  });
  expect(textDocument.nodes.find((node) => node.id === ids.frame)).toMatchObject({
    childIds: [ids.rectangle, ids.sibling],
  });
  expect(textDocument.nodes.find((node) => node.id === ids.sibling)).toMatchObject({
    parentId: ids.frame,
    transform: [1, 0, 0, 1, 70, 340],
  });

  const beforeEllipsePage = unwrap(pageMatrixForNode(before, ids.child, '/nodeIds/0'));
  const movedEllipse = unwrap(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.child],
      pageId: ids.page1,
      parentId: ids.frame,
      index: 1,
    }),
  );
  const ellipseDocument = documentFromContent(before, movedEllipse, 1);
  expect(pageMatrixForNode(ellipseDocument, ids.child, '/nodeIds/0')).toEqual({
    ok: true,
    value: beforeEllipsePage,
  });
  expect(ellipseDocument.pages[0]?.rootNodeIds.map(String)).toEqual([ids.frame, ids.sibling]);
  expect(ellipseDocument.nodes.find((node) => node.id === ids.frame)).toMatchObject({
    childIds: [ids.rectangle, ids.child],
  });
  expect(ellipseDocument.nodes.some((node) => node.id === ids.group)).toBe(false);
});

test('rejects invalid, cyclic, locked, cross-page, and no-change layer moves atomically', () => {
  const before = propertyDocument();
  const source = JSON.stringify(before);

  expect(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.frame, ids.frame],
      pageId: ids.page1,
      parentId: null,
      index: 0,
    }),
  ).toEqual({ ok: false, error: { code: 'id.duplicate', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.rectangle, ids.frame],
      pageId: ids.page1,
      parentId: null,
      index: 0,
    }),
  ).toEqual({ ok: false, error: { code: 'command.hierarchy-overlap', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.frame],
      pageId: ids.page1,
      parentId: ids.frame,
      index: 0,
    }),
  ).toEqual({ ok: false, error: { code: 'command.destination-cycle', path: '/parentId' } });
  expect(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.sibling],
      pageId: ids.page1,
      parentId: ids.sibling,
      index: 0,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'node.destination-not-container', path: '/parentId' },
  });
  expect(
    planCommand(before, {
      kind: 'move-nodes',
      nodeIds: [ids.frame],
      pageId: ids.page1,
      parentId: null,
      index: 0,
    }),
  ).toEqual({ ok: false, error: { code: 'command.no-change', path: '/' } });

  const locked = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.frame],
      patch: { locked: true },
    }),
  );
  const lockedDocument = documentFromContent(before, locked, 1);
  expect(
    planCommand(lockedDocument, {
      kind: 'move-nodes',
      nodeIds: [ids.sibling],
      pageId: ids.page1,
      parentId: ids.frame,
      index: 1,
    }),
  ).toEqual({ ok: false, error: { code: 'node.locked', path: '/nodes/0/locked' } });

  const otherPage = unwrap(
    planCommand(before, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const withSecondPage = documentFromContent(before, otherPage, 1);
  const activeFirstPage = unwrap(
    planCommand(withSecondPage, { kind: 'activate-page', pageId: ids.page1 }),
  );
  const multiPage = documentFromContent(withSecondPage, activeFirstPage, 2);
  expect(
    planCommand(multiPage, {
      kind: 'move-nodes',
      nodeIds: [ids.sibling],
      pageId: ids.page2,
      parentId: null,
      index: 0,
    }),
  ).toEqual({ ok: false, error: { code: 'command.destination-page-mismatch', path: '/pageId' } });
  expect(JSON.stringify(before)).toBe(source);
});

test('groups canonical sibling roots and ungroups them without changing page-space geometry', () => {
  const before = propertyDocument();
  const beforeFramePage = unwrap(pageMatrixForNode(before, ids.frame, '/nodeIds/0'));
  const beforeTextPage = unwrap(pageMatrixForNode(before, ids.sibling, '/nodeIds/1'));
  const grouped = unwrap(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.sibling, ids.frame],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  );
  const groupDocument = documentFromContent(before, grouped, 1);
  expect(groupDocument.pages[0]?.rootNodeIds.map(String)).toEqual([ids.emptyGroup, ids.group]);
  expect(groupDocument.nodes.find((node) => node.id === ids.emptyGroup)).toMatchObject({
    type: 'group',
    name: 'Selection',
    parentId: null,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [ids.frame, ids.sibling],
  });
  expect(pageMatrixForNode(groupDocument, ids.frame, '/nodeIds/0')).toEqual({
    ok: true,
    value: beforeFramePage,
  });
  expect(pageMatrixForNode(groupDocument, ids.sibling, '/nodeIds/1')).toEqual({
    ok: true,
    value: beforeTextPage,
  });

  const ungrouped = unwrap(
    planCommand(groupDocument, { kind: 'ungroup-node', nodeId: ids.emptyGroup }),
  );
  // Grouping non-contiguous roots intentionally collapses them into one layer
  // at the earliest target slot. Ungrouping restores that Group's child order
  // at the same slot instead of trying to reconstruct unrelated layer gaps.
  const ungroupedDocument = documentFromContent(before, ungrouped, 2);
  expect(ungroupedDocument.pages[0]?.rootNodeIds.map(String)).toEqual([
    ids.frame,
    ids.sibling,
    ids.group,
  ]);
  expect(pageMatrixForNode(ungroupedDocument, ids.frame, '/nodeIds/0')).toEqual({
    ok: true,
    value: beforeFramePage,
  });
  expect(pageMatrixForNode(ungroupedDocument, ids.sibling, '/nodeIds/1')).toEqual({
    ok: true,
    value: beforeTextPage,
  });

  const ungroupedExisting = unwrap(
    planCommand(before, { kind: 'ungroup-node', nodeId: ids.group }),
  );
  const existingGroupDocument = documentFromContent(before, ungroupedExisting, 1);
  expect(existingGroupDocument.pages[0]?.rootNodeIds.map(String)).toEqual([
    ids.frame,
    ids.child,
    ids.sibling,
  ]);
  expect(existingGroupDocument.nodes.find((node) => node.id === ids.child)).toMatchObject({
    parentId: null,
    transform: [1, 0, 0, 1, 336, 64],
  });
});

test('round-trips contiguous sibling grouping byte-for-byte', () => {
  const before = propertyDocument();
  const grouped = unwrap(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.sibling, ids.group],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  );
  const groupDocument = documentFromContent(before, grouped, 1);
  const ungrouped = unwrap(
    planCommand(groupDocument, { kind: 'ungroup-node', nodeId: ids.emptyGroup }),
  );
  expect(JSON.stringify(ungrouped)).toBe(
    JSON.stringify({
      name: before.name,
      pageOrder: before.pageOrder,
      activePageId: before.activePageId,
      pages: before.pages,
      nodes: before.nodes,
    }),
  );
});

test('rejects invalid, mixed-parent, overlapping, locked, and non-Group hierarchy commands atomically', () => {
  const before = propertyDocument();
  const source = JSON.stringify(before);

  expect(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.frame, ids.frame],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  ).toEqual({ ok: false, error: { code: 'id.duplicate', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.rectangle, ids.frame],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  ).toEqual({ ok: false, error: { code: 'command.hierarchy-overlap', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.rectangle, ids.child],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  ).toEqual({ ok: false, error: { code: 'command.group-parent-mismatch', path: '/nodeIds/1' } });
  expect(
    planCommand(before, {
      kind: 'group-nodes',
      nodeIds: [ids.frame, ids.sibling],
      group: { id: ids.group, name: 'Selection' },
    }),
  ).toEqual({ ok: false, error: { code: 'id.duplicate', path: '/group/id' } });
  expect(planCommand(before, { kind: 'ungroup-node', nodeId: ids.frame })).toEqual({
    ok: false,
    error: { code: 'node.not-group', path: '/nodeId' },
  });

  const locked = unwrap(
    planCommand(before, {
      kind: 'set-node-properties',
      nodeIds: [ids.frame],
      patch: { locked: true },
    }),
  );
  const lockedDocument = documentFromContent(before, locked, 1);
  expect(
    planCommand(lockedDocument, {
      kind: 'group-nodes',
      nodeIds: [ids.frame, ids.sibling],
      group: { id: ids.emptyGroup, name: 'Selection' },
    }),
  ).toEqual({ ok: false, error: { code: 'node.locked', path: '/nodes/0/locked' } });
  expect(JSON.stringify(before)).toBe(source);
});

test('enforces page index and no-change contracts', () => {
  const before = initialDocument();
  expect(planCommand(before, null as unknown as never)).toEqual({
    ok: false,
    error: { code: 'command.invalid', path: '/' },
  });
  expect(
    planCommand(before, {
      kind: 'create-page',
      id: ids.page2,
      name: 'Page 2',
      index: 2,
    }),
  ).toEqual({ ok: false, error: { code: 'command.index', path: '/index' } });
  expect(planCommand(before, { kind: 'rename-page', pageId: ids.page1, name: 'Page 1' })).toEqual({
    ok: false,
    error: { code: 'command.no-change', path: '/' },
  });
  expect(planCommand(before, { kind: 'activate-page', pageId: ids.page1 })).toEqual({
    ok: false,
    error: { code: 'command.no-change', path: '/' },
  });
  const page2 = unwrap(
    planCommand(before, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const document2 = documentFromContent(before, page2, 1);
  expect(planCommand(document2, { kind: 'reorder-page', pageId: ids.page2, index: 1 })).toEqual({
    ok: false,
    error: { code: 'command.no-change', path: '/' },
  });
  expect(
    planCommand(document2, { kind: 'reorder-page', pageId: ids.page2, index: 0 }),
  ).toMatchObject({
    ok: true,
    value: { pageOrder: [ids.page2, ids.page1] },
  });
});

test('deletes active pages by preferring the previous survivor and retains non-active pages', () => {
  const before = initialDocument();
  const page2 = unwrap(
    planCommand(before, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const document2 = documentFromContent(before, page2, 1);
  const page3 = unwrap(
    planCommand(document2, { kind: 'create-page', id: ids.page3, name: 'Page 3', index: 2 }),
  );
  const document3 = documentFromContent(document2, page3, 2);
  const activeMiddle = unwrap(planCommand(document3, { kind: 'activate-page', pageId: ids.page2 }));
  const activeMiddleDocument = documentFromContent(document3, activeMiddle, 3);

  const deletedActive = planCommand(activeMiddleDocument, {
    kind: 'delete-page',
    pageId: ids.page2,
  });
  expect(deletedActive).toMatchObject({ ok: true, value: { activePageId: ids.page1 } });
  const deletedNonActive = planCommand(activeMiddleDocument, {
    kind: 'delete-page',
    pageId: ids.page3,
  });
  expect(deletedNonActive).toMatchObject({ ok: true, value: { activePageId: ids.page2 } });
  expect(planCommand(before, { kind: 'delete-page', pageId: ids.page1 })).toEqual({
    ok: false,
    error: { code: 'page.last-required', path: '/pageOrder' },
  });
});

test('rejects locked descendants, locked page forests, and cross-page insertion', () => {
  const before = initialDocument();
  const page2 = unwrap(
    planCommand(before, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const twoPages = documentFromContent(before, page2, 1);
  const inserted = unwrap(planCommand(twoPages, frameCommand()));
  const withTree = documentFromContent(twoPages, inserted, 2);
  const locked = unwrap(
    validateDocument({
      ...withTree,
      nodes: withTree.nodes.map((node, index) => (index === 1 ? { ...node, locked: true } : node)),
    }),
  );

  expect(planCommand(locked, { kind: 'delete-node', nodeId: ids.frame })).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/1/locked' },
  });
  expect(planCommand(locked, { kind: 'delete-page', pageId: ids.page1 })).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/1/locked' },
  });
  expect(
    planCommand(locked, {
      ...frameCommand(ids.page2),
      parentId: ids.frame,
      rootId: ids.group,
      nodes: [
        {
          id: ids.group,
          type: 'group' as const,
          name: 'Wrong page',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.child],
        },
        {
          id: ids.child,
          type: 'rectangle' as const,
          name: 'Child',
          parentId: ids.group,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          width: 10,
          height: 10,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid' as const, r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
      ],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'command.destination-page-mismatch', path: '/parentId' },
  });
});

test('does not mutate through a locked ancestor or destination', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);
  const lockedFrame = unwrap(
    validateDocument({
      ...document,
      nodes: document.nodes.map((node, index) => (index === 0 ? { ...node, locked: true } : node)),
    }),
  );

  expect(planCommand(lockedFrame, { kind: 'delete-node', nodeId: ids.rectangle })).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/0/locked' },
  });
  expect(
    planCommand(lockedFrame, {
      kind: 'insert-subtree',
      pageId: ids.page1,
      parentId: ids.frame,
      index: 1,
      rootId: ids.group,
      nodes: [
        {
          id: ids.group,
          type: 'group' as const,
          name: 'Blocked group',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.child],
        },
        {
          id: ids.child,
          type: 'rectangle' as const,
          name: 'Blocked child',
          parentId: ids.group,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          width: 10,
          height: 10,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid' as const, r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
      ],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/0/locked' },
  });
});

test('prunes a Group that becomes empty while preserving its Frame', () => {
  const before = initialDocument();
  const inserted = unwrap(
    planCommand(before, {
      kind: 'insert-subtree',
      pageId: ids.page1,
      parentId: null,
      index: 0,
      rootId: ids.frame,
      nodes: [
        {
          id: ids.frame,
          type: 'frame' as const,
          name: 'Frame',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.group],
          width: 400,
          height: 300,
          cornerRadii: [0, 0, 0, 0],
          background: null,
          stroke: null,
          clipChildren: false,
        },
        {
          id: ids.group,
          type: 'group' as const,
          name: 'Group',
          parentId: ids.frame,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.child],
        },
        {
          id: ids.child,
          type: 'rectangle' as const,
          name: 'Child',
          parentId: ids.group,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          width: 10,
          height: 10,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid' as const, r: 0, g: 0, b: 0, a: 1 },
          stroke: null,
        },
      ],
    }),
  );
  const document = documentFromContent(before, inserted, 1);
  const result = planCommand(document, { kind: 'delete-node', nodeId: ids.child });

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) return;
  expect(result.value.nodes).toHaveLength(1);
  expect(result.value.nodes[0]).toMatchObject({ id: ids.frame, childIds: [] });
});

test('deletes multiple sibling subtrees atomically', () => {
  const before = initialDocument();
  const inserted = unwrap(
    planCommand(before, {
      ...frameCommand(),
      nodes: [
        {
          ...(frameCommand().nodes[0] as FrameNodeInput),
          childIds: [ids.rectangle, ids.child],
        },
        frameCommand().nodes[1],
        {
          ...frameCommand().nodes[1],
          id: ids.child,
          name: 'Sibling rectangle',
        },
      ],
    }),
  );
  const document = documentFromContent(before, inserted, 1);

  expect(
    planCommand(document, {
      kind: 'delete-nodes',
      nodeIds: [ids.rectangle, ids.child],
    }),
  ).toMatchObject({
    ok: true,
    value: {
      pages: [{ id: ids.page1, rootNodeIds: [ids.frame] }],
      nodes: [{ id: ids.frame, childIds: [] }],
    },
  });
});

test('normalizes duplicate and overlapping targets while recursively pruning newly empty Groups', () => {
  const before = initialDocument();
  const inserted = unwrap(
    planCommand(before, {
      kind: 'insert-subtree',
      pageId: ids.page1,
      parentId: null,
      index: 0,
      rootId: ids.frame,
      nodes: [
        {
          ...(frameCommand().nodes[0] as FrameNodeInput),
          childIds: [ids.rectangle, ids.group],
        },
        frameCommand().nodes[1],
        {
          id: ids.group,
          type: 'group',
          name: 'Outer group',
          parentId: ids.frame,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.nestedGroup, ids.sibling],
        },
        {
          id: ids.nestedGroup,
          type: 'group',
          name: 'Nested group',
          parentId: ids.group,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          childIds: [ids.child],
        },
        {
          ...frameCommand().nodes[1],
          id: ids.child,
          name: 'Nested child',
          parentId: ids.nestedGroup,
        },
        {
          ...frameCommand().nodes[1],
          id: ids.sibling,
          name: 'Group sibling',
          parentId: ids.group,
        },
      ],
    }),
  );
  const document = documentFromContent(before, inserted, 1);

  expect(
    planCommand(document, {
      kind: 'delete-nodes',
      nodeIds: [ids.nestedGroup, ids.child, ids.nestedGroup, ids.sibling],
    }),
  ).toMatchObject({
    ok: true,
    value: {
      pages: [{ id: ids.page1, rootNodeIds: [ids.frame] }],
      nodes: [{ id: ids.frame, childIds: [ids.rectangle] }, { id: ids.rectangle }],
    },
  });
});

test('rejects malformed atomic delete target arrays', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);

  expect(planCommand(document, { kind: 'delete-nodes', nodeIds: [] })).toEqual({
    ok: false,
    error: { code: 'array.empty', path: '/nodeIds' },
  });
  expect(
    planCommand(document, {
      kind: 'delete-nodes',
      nodeIds: [ids.rectangle, 'not-a-uuid'],
    }),
  ).toEqual({ ok: false, error: { code: 'id.invalid', path: '/nodeIds/1' } });
});

test('keeps atomic delete failures byte-identical for missing, inactive, and locked nodes', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);
  const assertAtomicFailure = (
    source: BringsDocument,
    command: Parameters<typeof planCommand>[1],
    expected: ReturnType<typeof planCommand>,
  ) => {
    const json = JSON.stringify(source);
    expect(planCommand(source, command)).toEqual(expected);
    expect(JSON.stringify(source)).toBe(json);
  };

  assertAtomicFailure(
    document,
    { kind: 'delete-nodes', nodeIds: [ids.document] },
    { ok: false, error: { code: 'node.not-found', path: '/nodeIds/0' } },
  );

  const page2 = unwrap(
    planCommand(document, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const inactive = documentFromContent(document, page2, 2);
  assertAtomicFailure(
    inactive,
    { kind: 'delete-nodes', nodeIds: [ids.frame] },
    {
      ok: false,
      error: { code: 'command.source-page-mismatch', path: '/nodeIds/0' },
    },
  );

  const locked = unwrap(
    validateDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === ids.rectangle ? { ...node, locked: true } : node,
      ),
    }),
  );
  assertAtomicFailure(
    locked,
    { kind: 'delete-nodes', nodeIds: [ids.frame] },
    { ok: false, error: { code: 'node.locked', path: '/nodes/1/locked' } },
  );
});

test('rejects atomic deletion through a locked ancestor without mutating the source', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);
  const lockedAncestor = unwrap(
    validateDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === ids.frame ? { ...node, locked: true } : node,
      ),
    }),
  );
  const json = JSON.stringify(lockedAncestor);

  expect(
    planCommand(lockedAncestor, {
      kind: 'delete-nodes',
      nodeIds: [ids.rectangle],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'node.locked', path: '/nodes/0/locked' },
  });
  expect(JSON.stringify(lockedAncestor)).toBe(json);
});

test('does not prune an unrelated Group that was already empty before atomic deletion', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);
  const invalidSource = {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      rootNodeIds: [...page.rootNodeIds, ids.emptyGroup],
    })),
    nodes: [
      ...document.nodes,
      {
        id: ids.emptyGroup,
        type: 'group',
        name: 'Pre-existing empty group',
        parentId: null,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 0, 0],
        childIds: [],
      },
    ],
  } as unknown as BringsDocument;
  const json = JSON.stringify(invalidSource);

  expect(
    planCommand(invalidSource, {
      kind: 'delete-nodes',
      nodeIds: [ids.rectangle],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'node.group-empty', path: '/nodes/1/childIds' },
  });
  expect(JSON.stringify(invalidSource)).toBe(json);
});

test('applies a page-space transform delta to a nested node without retaining command values', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = unwrap(
    validateDocument({
      id: before.id,
      revision: 1,
      ...inserted,
      nodes: inserted.nodes.map((node) =>
        node.id === ids.frame ? { ...node, transform: [2, 0, 0, 2, 100, 50] } : node,
      ),
    }),
  );
  const command = {
    kind: 'apply-transform-delta' as const,
    nodeIds: [ids.rectangle],
    delta: [1, 0, 0, 1, 10, -6],
  };
  const result = planCommand(document, command);

  expect(result).toMatchObject({
    ok: true,
    value: { nodes: [{ id: ids.frame }, { id: ids.rectangle, transform: [1, 0, 0, 1, 25, 17] }] },
  });
  if (!result.ok) return;
  command.delta[4] = 999;
  expect(result.value.nodes[1]?.transform).toEqual([1, 0, 0, 1, 25, 17]);
});

test('applies one delta atomically to multiple top-level transform targets', () => {
  const before = initialDocument();
  const insertedFrame = unwrap(planCommand(before, frameCommand()));
  const withFrame = documentFromContent(before, insertedFrame, 1);
  const insertedRoot = unwrap(
    planCommand(withFrame, {
      kind: 'insert-subtree',
      pageId: ids.page1,
      parentId: null,
      index: 1,
      rootId: ids.child,
      nodes: [
        {
          id: ids.child,
          type: 'rectangle',
          name: 'Root rectangle',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 500, 60],
          width: 40,
          height: 30,
          cornerRadii: [0, 0, 0, 0],
          fill: null,
          stroke: null,
        },
      ],
    }),
  );
  const document = documentFromContent(withFrame, insertedRoot, 2);

  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame, ids.child],
      delta: [1, 0, 0, 1, 3, 4],
    }),
  ).toMatchObject({
    ok: true,
    value: {
      nodes: [
        { id: ids.frame, transform: [1, 0, 0, 1, 3, 4] },
        { id: ids.rectangle, transform: [1, 0, 0, 1, 20, 20] },
        { id: ids.child, transform: [1, 0, 0, 1, 503, 64] },
      ],
    },
  });
});

test('rejects malformed and structurally overlapping transform targets', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);

  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'array.empty', path: '/nodeIds' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame, ids.frame],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'id.duplicate', path: '/nodeIds/1' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.document],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'node.not-found', path: '/nodeIds/0' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame, ids.rectangle],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'command.transform-overlap', path: '/nodeIds/1' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame],
      delta: [Number.NaN, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'matrix.invalid', path: '/delta/0' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame],
      delta: [1, 0, 0, 0, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'matrix.singular', path: '/delta' } });
  expect(
    planCommand(document, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame],
      delta: [1, 0, 0, 1, 0, 0],
    }),
  ).toEqual({ ok: false, error: { code: 'command.no-change', path: '/' } });
});

test('rejects locked and inactive-page transform targets before mutation', () => {
  const before = initialDocument();
  const inserted = unwrap(planCommand(before, frameCommand()));
  const document = documentFromContent(before, inserted, 1);
  const locked = unwrap(
    validateDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === ids.frame ? { ...node, locked: true } : node,
      ),
    }),
  );

  expect(
    planCommand(locked, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.rectangle],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({ ok: false, error: { code: 'node.locked', path: '/nodes/0/locked' } });

  const page2 = unwrap(
    planCommand(document, { kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }),
  );
  const inactive = documentFromContent(document, page2, 2);
  expect(
    planCommand(inactive, {
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame],
      delta: [1, 0, 0, 1, 1, 1],
    }),
  ).toEqual({
    ok: false,
    error: { code: 'command.source-page-mismatch', path: '/nodeIds/0' },
  });
});

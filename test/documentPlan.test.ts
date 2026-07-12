import { expect, test } from 'bun:test';
import {
  createDocument,
  validateDocument,
  type BringsDocument,
  type DocumentContent,
} from '../src';
import { planCommand } from '../src/document/plan';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page1: '22222222-2222-4222-8222-222222222222',
  page2: '33333333-3333-4333-8333-333333333333',
  page3: '44444444-4444-4444-8444-444444444444',
  frame: '55555555-5555-4555-8555-555555555555',
  rectangle: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
  child: '88888888-8888-4888-8888-888888888888',
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

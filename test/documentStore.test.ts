import { expect, test } from 'bun:test';
import { createDocumentStore, validateDocument } from '../src';
import { nextDocumentRevision } from '../src/document/revision';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page1: '22222222-2222-4222-8222-222222222222',
  page2: '33333333-3333-4333-8333-333333333333',
  page3: '44444444-4444-4444-8444-444444444444',
  frame: '55555555-5555-4555-8555-555555555555',
  rectangle: '66666666-6666-4666-8666-666666666666',
} as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function createStore() {
  return unwrap(
    createDocumentStore({
      id: ids.document,
      name: 'Untitled',
      initialPage: { id: ids.page1, name: 'Page 1' },
    }),
  );
}

const insertFrame = {
  kind: 'insert-subtree' as const,
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

test('executes, undoes, and redoes with identity preservation and monotonic revision', () => {
  const store = createStore();
  const initial = store.snapshot();

  expect(store.execute(insertFrame).ok).toBe(true);
  expect(store.snapshot().document.revision).toBe(1);
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot().document.revision).toBe(2);
  expect(store.snapshot().document.nodes).toEqual([]);
  expect(store.redo().ok).toBe(true);
  expect(store.snapshot().document.revision).toBe(3);
  expect(store.snapshot().document.id).toBe(initial.document.id);
});

test('records Frame and nested Rectangle creation as independent undoable intentions', () => {
  const store = createStore();
  expect(
    store.execute({
      kind: 'create-frame',
      pageId: ids.page1,
      parentId: null,
      index: 0,
      frame: {
        id: ids.frame,
        name: 'Frame',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 0, 0],
        width: 400,
        height: 300,
        cornerRadii: [0, 0, 0, 0],
        background: null,
        stroke: null,
        clipChildren: false,
      },
    }).ok,
  ).toBe(true);
  expect(
    store.execute({
      kind: 'create-rectangle',
      pageId: ids.page1,
      parentId: ids.frame,
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
        fill: { type: 'solid', r: 0, g: 0.5, b: 1, a: 1 },
        stroke: null,
      },
    }).ok,
  ).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: { revision: 2, nodes: [{ childIds: [ids.rectangle] }, { id: ids.rectangle }] },
    undoDepth: 2,
  });
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({ document: { nodes: [{ childIds: [] }] }, undoDepth: 1 });
  expect(store.redo().ok).toBe(true);
  expect(store.snapshot().document.nodes.map((node) => node.id as string)).toEqual([
    ids.frame,
    ids.rectangle,
  ]);
});

test('preserves stacks for empty history and failed execution', () => {
  const store = createStore();
  const initial = JSON.stringify(store.snapshot());
  expect(store.undo()).toEqual({
    ok: false,
    error: { code: 'history.undo-empty', path: '/history/undo' },
  });
  expect(store.redo()).toEqual({
    ok: false,
    error: { code: 'history.redo-empty', path: '/history/redo' },
  });
  expect(JSON.stringify(store.snapshot())).toBe(initial);

  expect(store.execute({ kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }).ok).toBe(
    true,
  );
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot().redoDepth).toBe(1);
  const beforeFailure = JSON.stringify(store.snapshot());
  expect(
    store.execute({ kind: 'create-page', id: 'not-a-uuid', name: 'Bad page', index: 1 }).ok,
  ).toBe(false);
  expect(JSON.stringify(store.snapshot())).toBe(beforeFailure);
  expect(store.redo().ok).toBe(true);
});

test('activating a page preserves redo and deleting its active page is undoable', () => {
  const store = createStore();
  expect(store.execute({ kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }).ok).toBe(
    true,
  );
  expect(store.execute({ kind: 'create-page', id: ids.page3, name: 'Page 3', index: 2 }).ok).toBe(
    true,
  );
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({ undoDepth: 1, redoDepth: 1 });

  expect(store.execute({ kind: 'activate-page', pageId: ids.page1 }).ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: { revision: 4, activePageId: ids.page1 },
    undoDepth: 1,
    redoDepth: 1,
    selection: { nodeIds: [], activeNodeId: null },
  });
  expect(store.redo().ok).toBe(true);
  expect(store.snapshot().document.revision).toBe(5);

  expect(store.execute({ kind: 'activate-page', pageId: ids.page2 }).ok).toBe(true);
  expect(store.execute({ kind: 'delete-page', pageId: ids.page2 }).ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: { activePageId: ids.page1 },
    selection: { nodeIds: [], activeNodeId: null },
  });
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot().document.activePageId as string).toBe(ids.page2);
});

test('returns detached snapshots', () => {
  const store = createStore();
  const snapshot = store.snapshot();
  (snapshot.document.pages as unknown as { name: string }[])[0]!.name = 'Mutated page';
  (snapshot.document.nodes as unknown as unknown[]).push({ id: 'mutated' });
  (snapshot.selection.nodeIds as unknown as string[]).push('mutated');

  expect(store.snapshot()).toMatchObject({
    document: { pages: [{ name: 'Page 1' }], nodes: [] },
    selection: { nodeIds: [], activeNodeId: null },
  });
});

test('rejects revision overflow without constructing an unsafe revision', () => {
  const document = unwrap(
    validateDocument({
      id: ids.document,
      revision: Number.MAX_SAFE_INTEGER,
      name: 'Untitled',
      pageOrder: [ids.page1],
      activePageId: ids.page1,
      pages: [{ id: ids.page1, name: 'Page 1', rootNodeIds: [] }],
      nodes: [],
    }),
  );
  expect(
    nextDocumentRevision(document, {
      name: document.name,
      pageOrder: document.pageOrder,
      activePageId: document.activePageId,
      pages: document.pages,
      nodes: document.nodes,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'revision.overflow', path: '/revision' },
  });
});

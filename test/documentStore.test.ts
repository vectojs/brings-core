import { expect, test } from 'bun:test';
import { createDocumentStore, openDocumentStore, validateDocument } from '../src';
import { nextDocumentRevision } from '../src/document/revision';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page1: '22222222-2222-4222-8222-222222222222',
  page2: '33333333-3333-4333-8333-333333333333',
  page3: '44444444-4444-4444-8444-444444444444',
  frame: '55555555-5555-4555-8555-555555555555',
  rectangle: '66666666-6666-4666-8666-666666666666',
  secondRectangle: '77777777-7777-4777-8777-777777777777',
  group: '88888888-8888-4888-8888-888888888888',
  text: '99999999-9999-4999-8999-999999999999',
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

function selectionValue(store: ReturnType<typeof createStore>) {
  const selection = store.snapshot().selection;
  return {
    nodeIds: selection.nodeIds.map(String),
    activeNodeId: selection.activeNodeId === null ? null : String(selection.activeNodeId),
  };
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

function insertFrameWithSibling(secondRectangleLocked = false) {
  return {
    ...insertFrame,
    nodes: [
      { ...insertFrame.nodes[0], childIds: [ids.rectangle, ids.secondRectangle] },
      insertFrame.nodes[1],
      {
        ...insertFrame.nodes[1],
        id: ids.secondRectangle,
        name: 'Second Rectangle',
        locked: secondRectangleLocked,
        transform: [1, 0, 0, 1, 160, 20] as const,
      },
    ],
  };
}

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

test('opens an existing document with detached ownership and empty ephemeral state', () => {
  const source = createStore().snapshot().document as unknown as {
    revision: number;
    name: string;
    pages: { name: string }[];
  };
  source.revision = 7;
  const opened = openDocumentStore(source as never);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  source.name = 'Caller mutation';
  source.pages[0]!.name = 'Caller page mutation';

  expect(opened.value.snapshot()).toMatchObject({
    document: { revision: 7, name: 'Untitled', pages: [{ name: 'Page 1' }] },
    selection: { nodeIds: [], activeNodeId: null },
    undoDepth: 0,
    redoDepth: 0,
  });
});

test('continues existing revisions monotonically through execute undo and redo', () => {
  const source = createStore().snapshot().document as unknown as { revision: number };
  source.revision = 7;
  const opened = unwrap(openDocumentStore(source as never));

  expect(opened.execute({ kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }).ok).toBe(
    true,
  );
  expect(opened.snapshot()).toMatchObject({
    document: { revision: 8 },
    undoDepth: 1,
    redoDepth: 0,
  });
  expect(opened.undo().ok).toBe(true);
  expect(opened.snapshot()).toMatchObject({
    document: { revision: 9 },
    undoDepth: 0,
    redoDepth: 1,
  });
  expect(opened.redo().ok).toBe(true);
  expect(opened.snapshot()).toMatchObject({
    document: { revision: 10 },
    undoDepth: 1,
    redoDepth: 0,
  });
});

test('rejects malformed existing documents before creating a store', () => {
  expect(openDocumentStore({ revision: -1 } as never)).toEqual({
    ok: false,
    error: { code: 'field.required', path: '/id' },
  });
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

test('records Text creation as one undoable intention', () => {
  const store = createStore();
  const created = store.execute({
    kind: 'create-text',
    pageId: ids.page1,
    parentId: null,
    index: 0,
    text: {
      id: ids.text,
      name: 'Text',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 20, 30],
      content: 'Editable',
      fontFamilies: ['Inter'],
      fontWeight: 400,
      fontSize: 16,
      lineHeight: 24,
      horizontalAlign: 'left',
      layoutMode: 'fixedBox',
      width: 120,
      height: 24,
      fill: { type: 'solid', r: 0, g: 0, b: 0, a: 1 },
    },
  });

  expect(created.ok).toBe(true);
  expect(store.snapshot()).toMatchObject({ document: { revision: 1 }, undoDepth: 1 });
  expect(store.snapshot().document.nodes).toMatchObject([{ id: ids.text, type: 'text' }]);
  expect(store.undo().ok).toBe(true);
  expect(store.snapshot().document.nodes).toEqual([]);
  expect(store.redo().ok).toBe(true);
  expect(store.snapshot().document.nodes).toMatchObject([{ content: 'Editable' }]);
});

test('normalizes ephemeral selection without changing durable state or history', () => {
  const store = createStore();
  expect(store.execute(insertFrame).ok).toBe(true);
  const before = store.snapshot();
  const selectionStore = store as unknown as {
    setSelection(input: { nodeIds: readonly string[]; activeNodeId: string | null }): unknown;
  };

  expect(
    selectionStore.setSelection({
      nodeIds: [ids.rectangle, ids.frame, ids.rectangle],
      activeNodeId: ids.rectangle,
    }),
  ).toMatchObject({
    ok: true,
    value: { selection: { nodeIds: [ids.frame], activeNodeId: ids.frame } },
  });
  expect(store.snapshot()).toMatchObject({
    document: { revision: before.document.revision },
    undoDepth: before.undoDepth,
    redoDepth: before.redoDepth,
  });
});

test('rejects invalid selection atomically', () => {
  const store = createStore();
  expect(store.execute(insertFrame).ok).toBe(true);
  const selectionStore = store as unknown as {
    setSelection(input: { nodeIds: readonly string[]; activeNodeId: string | null }): unknown;
  };
  expect(selectionStore.setSelection({ nodeIds: ['not-a-uuid'], activeNodeId: null })).toEqual({
    ok: false,
    error: { code: 'id.invalid', path: '/nodeIds/0' },
  });
  expect(store.snapshot().selection).toEqual({ nodeIds: [], activeNodeId: null });
});

test('rejects locked, hidden, and inactive-page selection targets', () => {
  const selectionStore = (store: ReturnType<typeof createStore>) =>
    store as unknown as {
      setSelection(input: { nodeIds: readonly string[]; activeNodeId: string | null }): unknown;
    };
  const lockedStore = createStore();
  const lockedFrame = {
    ...insertFrame,
    nodes: [{ ...insertFrame.nodes[0], locked: true }, insertFrame.nodes[1]],
  };
  expect(lockedStore.execute(lockedFrame).ok).toBe(true);
  expect(
    selectionStore(lockedStore).setSelection({ nodeIds: [ids.frame], activeNodeId: ids.frame }),
  ).toEqual({
    ok: false,
    error: { code: 'selection.ineligible', path: '/nodeIds/0' },
  });

  const hiddenStore = createStore();
  const hiddenFrame = {
    ...insertFrame,
    nodes: [insertFrame.nodes[0], { ...insertFrame.nodes[1], visible: false }],
  };
  expect(hiddenStore.execute(hiddenFrame).ok).toBe(true);
  expect(
    selectionStore(hiddenStore).setSelection({
      nodeIds: [ids.rectangle],
      activeNodeId: ids.rectangle,
    }),
  ).toEqual({ ok: false, error: { code: 'selection.ineligible', path: '/nodeIds/0' } });

  const crossPageStore = createStore();
  expect(crossPageStore.execute(insertFrame).ok).toBe(true);
  expect(
    crossPageStore.execute({ kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }).ok,
  ).toBe(true);
  expect(
    selectionStore(crossPageStore).setSelection({ nodeIds: [ids.frame], activeNodeId: ids.frame }),
  ).toEqual({ ok: false, error: { code: 'selection.page-mismatch', path: '/nodeIds/0' } });
});

test('restores captured ephemeral selection when undoing a durable command', () => {
  const store = createStore();
  expect(store.execute(insertFrame).ok).toBe(true);
  const selectionStore = store as unknown as {
    setSelection(input: { nodeIds: readonly string[]; activeNodeId: string | null }): unknown;
  };
  expect(
    selectionStore.setSelection({ nodeIds: [ids.rectangle], activeNodeId: ids.rectangle }),
  ).toMatchObject({
    ok: true,
    value: { selection: { nodeIds: [ids.rectangle], activeNodeId: ids.rectangle } },
  });
  expect(store.execute({ kind: 'create-page', id: ids.page2, name: 'Page 2', index: 1 }).ok).toBe(
    true,
  );
  expect(store.snapshot().selection).toEqual({ nodeIds: [], activeNodeId: null });
  expect(store.undo().ok).toBe(true);
  expect({
    nodeIds: store.snapshot().selection.nodeIds.map((nodeId) => nodeId as string),
    activeNodeId: store.snapshot().selection.activeNodeId as string | null,
  }).toEqual({ nodeIds: [ids.rectangle], activeNodeId: ids.rectangle });
  expect(store.redo().ok).toBe(true);
  expect(store.snapshot().selection).toEqual({ nodeIds: [], activeNodeId: null });
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

test('records one transform intention while preserving selection through undo and redo', () => {
  const store = createStore();
  expect(store.execute(insertFrame).ok).toBe(true);
  expect(store.setSelection({ nodeIds: [ids.rectangle], activeNodeId: ids.rectangle }).ok).toBe(
    true,
  );

  expect(
    store.execute({
      kind: 'apply-transform-delta',
      nodeIds: [ids.rectangle],
      delta: [1, 0, 0, 1, 10, -5],
    }).ok,
  ).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: {
      revision: 2,
      nodes: [{ id: ids.frame }, { id: ids.rectangle, transform: [1, 0, 0, 1, 30, 15] }],
    },
    selection: { nodeIds: [ids.rectangle], activeNodeId: ids.rectangle },
    undoDepth: 2,
    redoDepth: 0,
  });

  expect(store.undo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: {
      revision: 3,
      nodes: [{ id: ids.frame }, { id: ids.rectangle, transform: [1, 0, 0, 1, 20, 20] }],
    },
    selection: { nodeIds: [ids.rectangle], activeNodeId: ids.rectangle },
    undoDepth: 1,
    redoDepth: 1,
  });

  expect(store.redo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: {
      revision: 4,
      nodes: [{ id: ids.frame }, { id: ids.rectangle, transform: [1, 0, 0, 1, 30, 15] }],
    },
    selection: { nodeIds: [ids.rectangle], activeNodeId: ids.rectangle },
    undoDepth: 2,
    redoDepth: 0,
  });
});

test('reconciles selection after property and hierarchy commands while preserving history', () => {
  const store = createStore();
  expect(store.execute(insertFrameWithSibling()).ok).toBe(true);
  expect(
    store.setSelection({
      nodeIds: [ids.rectangle, ids.secondRectangle],
      activeNodeId: ids.secondRectangle,
    }).ok,
  ).toBe(true);

  expect(
    store.execute({
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { name: 'Primary card' },
    }).ok,
  ).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.rectangle, ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });

  expect(
    store.execute({
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { visible: false },
    }).ok,
  ).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });
  expect(store.undo().ok).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.rectangle, ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });
  expect(store.redo().ok).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });

  expect(
    store.execute({
      kind: 'set-node-properties',
      nodeIds: [ids.secondRectangle],
      patch: { locked: true },
    }).ok,
  ).toBe(true);
  expect(selectionValue(store)).toEqual({ nodeIds: [], activeNodeId: null });
  expect(store.undo().ok).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });

  expect(
    store.execute({
      kind: 'set-node-properties',
      nodeIds: [ids.rectangle],
      patch: { visible: true },
    }).ok,
  ).toBe(true);
  expect(
    store.setSelection({
      nodeIds: [ids.rectangle, ids.secondRectangle],
      activeNodeId: ids.secondRectangle,
    }).ok,
  ).toBe(true);
  expect(
    store.execute({
      kind: 'group-nodes',
      nodeIds: [ids.secondRectangle, ids.rectangle],
      group: { id: ids.group, name: 'Cards' },
    }).ok,
  ).toBe(true);
  expect(selectionValue(store)).toEqual({
    nodeIds: [ids.rectangle, ids.secondRectangle],
    activeNodeId: ids.secondRectangle,
  });

  expect(store.setSelection({ nodeIds: [ids.group], activeNodeId: ids.group }).ok).toBe(true);
  expect(store.execute({ kind: 'ungroup-node', nodeId: ids.group }).ok).toBe(true);
  expect(selectionValue(store)).toEqual({ nodeIds: [], activeNodeId: null });
  expect(store.undo().ok).toBe(true);
  expect(selectionValue(store)).toEqual({ nodeIds: [ids.group], activeNodeId: ids.group });
  expect(store.redo().ok).toBe(true);
  expect(selectionValue(store)).toEqual({ nodeIds: [], activeNodeId: null });
});

test('leaves document selection and history byte-identical after a failed transform command', () => {
  const store = createStore();
  expect(store.execute(insertFrame).ok).toBe(true);
  expect(store.setSelection({ nodeIds: [ids.frame], activeNodeId: ids.frame }).ok).toBe(true);
  const before = JSON.stringify(store.snapshot());

  expect(
    store.execute({
      kind: 'apply-transform-delta',
      nodeIds: [ids.frame],
      delta: [1, 0, 0, 0, 10, 10],
    }),
  ).toEqual({ ok: false, error: { code: 'matrix.singular', path: '/delta' } });
  expect(JSON.stringify(store.snapshot())).toBe(before);
});

test('records one atomic deletion and restores the active selection through undo and redo', () => {
  const store = createStore();
  expect(store.execute(insertFrameWithSibling()).ok).toBe(true);
  expect(
    store.setSelection({
      nodeIds: [ids.rectangle, ids.secondRectangle],
      activeNodeId: ids.secondRectangle,
    }).ok,
  ).toBe(true);

  expect(
    store.execute({
      kind: 'delete-nodes',
      nodeIds: store.snapshot().selection.nodeIds,
    }).ok,
  ).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: { revision: 2, nodes: [{ id: ids.frame, childIds: [] }] },
    selection: { nodeIds: [], activeNodeId: null },
    undoDepth: 2,
    redoDepth: 0,
  });

  expect(store.undo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: {
      revision: 3,
      nodes: [{ id: ids.frame }, { id: ids.rectangle }, { id: ids.secondRectangle }],
    },
    selection: {
      nodeIds: [ids.rectangle, ids.secondRectangle],
      activeNodeId: ids.secondRectangle,
    },
    undoDepth: 1,
    redoDepth: 1,
  });

  expect(store.redo().ok).toBe(true);
  expect(store.snapshot()).toMatchObject({
    document: { revision: 4, nodes: [{ id: ids.frame, childIds: [] }] },
    selection: { nodeIds: [], activeNodeId: null },
    undoDepth: 2,
    redoDepth: 0,
  });
});

test('leaves the complete snapshot byte-identical after a locked atomic deletion fails', () => {
  const store = createStore();
  expect(store.execute(insertFrameWithSibling(true)).ok).toBe(true);
  expect(store.setSelection({ nodeIds: [ids.rectangle], activeNodeId: ids.rectangle }).ok).toBe(
    true,
  );
  const before = JSON.stringify(store.snapshot());

  expect(
    store.execute({
      kind: 'delete-nodes',
      nodeIds: [ids.rectangle, ids.secondRectangle],
    }),
  ).toEqual({ ok: false, error: { code: 'node.locked', path: '/nodes/2/locked' } });
  expect(JSON.stringify(store.snapshot())).toBe(before);
});

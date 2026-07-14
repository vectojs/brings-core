import { expect, test } from 'bun:test';
import {
  resolveStructuralSelection,
  validateDocument,
  type BringsDocument,
  type SceneNodeInput,
  type SelectionInput,
  type StructuralSelection,
} from '../src';
import { FIXTURE_IDS, validatedDocument } from './fixtures';

const OTHER_PAGE_ID = '77777777-7777-4777-8777-777777777777';

function frameNode(overrides: Partial<SceneNodeInput> = {}): SceneNodeInput {
  return {
    id: FIXTURE_IDS.frame,
    type: 'frame',
    name: 'Frame',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [FIXTURE_IDS.rectangle],
    width: 400,
    height: 300,
    cornerRadii: [0, 0, 0, 0],
    background: null,
    stroke: null,
    clipChildren: false,
    ...overrides,
  } as SceneNodeInput;
}

function rectangleNode(overrides: Partial<SceneNodeInput> = {}): SceneNodeInput {
  return {
    id: FIXTURE_IDS.rectangle,
    type: 'rectangle',
    name: 'Rectangle',
    parentId: FIXTURE_IDS.frame,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 20, 20],
    width: 120,
    height: 80,
    cornerRadii: [0, 0, 0, 0],
    fill: null,
    stroke: null,
    ...overrides,
  } as SceneNodeInput;
}

function nestedSelectionDocument(
  frameOverrides: Partial<SceneNodeInput> = {},
  rectangleOverrides: Partial<SceneNodeInput> = {},
): BringsDocument {
  return validatedDocument(
    [frameNode(frameOverrides), rectangleNode(rectangleOverrides)],
    [FIXTURE_IDS.frame],
  );
}

function inactivePageDocument(): BringsDocument {
  const result = validateDocument({
    id: FIXTURE_IDS.document,
    revision: 0,
    name: 'Fixture',
    pageOrder: [FIXTURE_IDS.page, OTHER_PAGE_ID],
    activePageId: FIXTURE_IDS.page,
    pages: [
      { id: FIXTURE_IDS.page, name: 'Page 1', rootNodeIds: [] },
      { id: OTHER_PAGE_ID, name: 'Page 2', rootNodeIds: [FIXTURE_IDS.frame] },
    ],
    nodes: [frameNode({ childIds: [] })],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function plainSelection(selection: StructuralSelection) {
  return {
    nodeIds: selection.nodeIds.map((nodeId) => nodeId as string),
    activeNodeId: selection.activeNodeId as string | null,
  };
}

test('normalizes an ancestor and descendant through the public pure boundary', () => {
  const document = nestedSelectionDocument();
  const input = {
    nodeIds: [FIXTURE_IDS.rectangle, FIXTURE_IDS.frame, FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  };
  const before = JSON.stringify(input);

  const result = resolveStructuralSelection(document, input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(plainSelection(result.value)).toEqual({
    nodeIds: [FIXTURE_IDS.frame],
    activeNodeId: FIXTURE_IDS.frame,
  });
  expect(JSON.stringify(input)).toBe(before);
});

test('removes duplicate nodes without changing their first-seen order', () => {
  const document = nestedSelectionDocument();

  const result = resolveStructuralSelection(document, {
    nodeIds: [FIXTURE_IDS.rectangle, FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(plainSelection(result.value)).toEqual({
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  });
});

test('falls back to the last normalized node when the requested active node is absent', () => {
  const document = nestedSelectionDocument();

  const result = resolveStructuralSelection(document, {
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.frame,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(plainSelection(result.value)).toEqual({
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  });
});

test('preserves stable errors for hidden and locked selection targets', () => {
  expect(
    resolveStructuralSelection(nestedSelectionDocument({}, { visible: false }), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'selection.ineligible', path: '/nodeIds/0' },
  });
  expect(
    resolveStructuralSelection(nestedSelectionDocument({ locked: true }), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'selection.ineligible', path: '/nodeIds/0' },
  });
});

test('rejects a node outside the active page at its original input path', () => {
  expect(
    resolveStructuralSelection(inactivePageDocument(), {
      nodeIds: [FIXTURE_IDS.frame],
      activeNodeId: FIXTURE_IDS.frame,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'selection.page-mismatch', path: '/nodeIds/0' },
  });
});

test('preserves the validation order for malformed selection input', () => {
  const document = nestedSelectionDocument();

  expect(resolveStructuralSelection(document, null as unknown as SelectionInput)).toEqual({
    ok: false,
    error: { code: 'selection.invalid', path: '/' },
  });
  expect(
    resolveStructuralSelection(document, {
      nodeIds: ['not-a-uuid'],
      activeNodeId: 'also-not-a-uuid',
    }),
  ).toEqual({
    ok: false,
    error: { code: 'id.invalid', path: '/nodeIds/0' },
  });
});

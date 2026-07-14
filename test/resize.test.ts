import { expect, test } from 'bun:test';
import {
  prepareSelectionResize,
  validateDocument,
  type BringsDocument,
  type ResizeHandle,
  type SceneNodeInput,
  type SelectionInput,
} from '../src';
import { FIXTURE_IDS, validatedDocument } from './fixtures';

const IDS = {
  group: '77777777-7777-4777-8777-777777777777',
  nestedGroup: '88888888-8888-4888-8888-888888888888',
  sibling: '99999999-9999-4999-8999-999999999999',
  otherPage: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} as const;

function rectangle(overrides: Partial<SceneNodeInput> = {}): SceneNodeInput {
  return {
    id: FIXTURE_IDS.rectangle,
    type: 'rectangle',
    name: 'Rectangle',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 10, 20],
    width: 100,
    height: 50,
    cornerRadii: [0, 0, 0, 0],
    fill: null,
    stroke: { paint: { type: 'solid', r: 0, g: 0, b: 0, a: 1 }, width: 20 },
    ...overrides,
  } as SceneNodeInput;
}

function group(overrides: Partial<SceneNodeInput> = {}): SceneNodeInput {
  return {
    id: IDS.group,
    type: 'group',
    name: 'Group',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [FIXTURE_IDS.rectangle],
    ...overrides,
  } as SceneNodeInput;
}

function baseDocument(overrides: Partial<SceneNodeInput> = {}): BringsDocument {
  return validatedDocument([rectangle(overrides)], [FIXTURE_IDS.rectangle]);
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('Expected a successful result.');
  return result.value;
}

test('prepares detached unstroked bounds and all eight handles', () => {
  const input = {
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  } as SelectionInput & { nodeIds: string[] };
  const prepared = unwrap(prepareSelectionResize(baseDocument(), input));
  input.nodeIds[0] = IDS.sibling;

  expect({
    nodeIds: prepared.selection.nodeIds.map(String),
    activeNodeId: prepared.selection.activeNodeId as string | null,
  }).toEqual({
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  });
  expect(prepared.bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  expect(prepared.handles).toEqual([
    { handle: 'north-west', point: { x: 10, y: 20 } },
    { handle: 'north', point: { x: 60, y: 20 } },
    { handle: 'north-east', point: { x: 110, y: 20 } },
    { handle: 'east', point: { x: 110, y: 45 } },
    { handle: 'south-east', point: { x: 110, y: 70 } },
    { handle: 'south', point: { x: 60, y: 70 } },
    { handle: 'south-west', point: { x: 10, y: 70 } },
    { handle: 'west', point: { x: 10, y: 45 } },
  ]);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.isFrozen(prepared.selection)).toBe(true);
  expect(Object.isFrozen(prepared.selection.nodeIds)).toBe(true);
  expect(Object.isFrozen(prepared.bounds)).toBe(true);
  expect(Object.isFrozen(prepared.handles)).toBe(true);
  expect(
    prepared.handles.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.point)),
  ).toBe(true);
});

test('derives recursive Group and multi-root model bounds through nested transforms', () => {
  const document = validatedDocument(
    [
      group({ transform: [2, 0, 0, 2, 10, 20], childIds: [IDS.nestedGroup] }),
      group({
        id: IDS.nestedGroup,
        parentId: IDS.group,
        transform: [1, 0, 0, 1, 5, 10],
        childIds: [FIXTURE_IDS.rectangle],
      }),
      rectangle({
        parentId: IDS.nestedGroup,
        transform: [1, 0, 0, 1, 0, 0],
        width: 20,
        height: 10,
      }),
      rectangle({
        id: IDS.sibling,
        name: 'Sibling',
        transform: [1, 0, 0, 1, 100, 50],
        width: 20,
        height: 30,
      }),
    ],
    [IDS.group, IDS.sibling],
  );

  const nested = unwrap(
    prepareSelectionResize(document, { nodeIds: [IDS.group], activeNodeId: IDS.group }),
  );
  expect(nested.bounds).toEqual({ minX: 20, minY: 40, maxX: 60, maxY: 60 });

  const multiple = unwrap(
    prepareSelectionResize(document, {
      nodeIds: [IDS.group, IDS.sibling],
      activeNodeId: IDS.sibling,
    }),
  );
  expect(multiple.bounds).toEqual({ minX: 20, minY: 40, maxX: 120, maxY: 80 });
  expect(multiple.selection.nodeIds.map(String)).toEqual([IDS.group, IDS.sibling]);
});

test('uses a Frame own model box instead of recursively expanding to overflowing children', () => {
  const document = validatedDocument(
    [
      {
        id: FIXTURE_IDS.frame,
        type: 'frame',
        name: 'Frame',
        parentId: null,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, 10, 20],
        childIds: [FIXTURE_IDS.rectangle],
        width: 100,
        height: 50,
        cornerRadii: [0, 0, 0, 0],
        background: null,
        stroke: null,
        clipChildren: false,
      } as SceneNodeInput,
      rectangle({ parentId: FIXTURE_IDS.frame, transform: [1, 0, 0, 1, 500, 500] }),
    ],
    [FIXTURE_IDS.frame],
  );
  const prepared = unwrap(
    prepareSelectionResize(document, {
      nodeIds: [FIXTURE_IDS.frame],
      activeNodeId: FIXTURE_IDS.frame,
    }),
  );
  expect(prepared.bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
});

test('returns exact opposite-anchor commands for every handle', () => {
  const prepared = unwrap(
    prepareSelectionResize(baseDocument(), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  const expectedAnchors: Record<ResizeHandle, { x: number; y: number }> = {
    'north-west': { x: 110, y: 70 },
    north: { x: 60, y: 70 },
    'north-east': { x: 10, y: 70 },
    east: { x: 10, y: 45 },
    'south-east': { x: 10, y: 20 },
    south: { x: 60, y: 20 },
    'south-west': { x: 110, y: 20 },
    west: { x: 110, y: 45 },
  };

  for (const entry of prepared.handles) {
    const proposal = unwrap(
      prepared.propose({
        handle: entry.handle,
        startPoint: entry.point,
        currentPoint: entry.point,
        preserveAspectRatio: false,
        fromCenter: false,
      }),
    );
    expect(proposal.anchor).toEqual(expectedAnchors[entry.handle]);
    expect(proposal.scaleX).toBe(1);
    expect(proposal.scaleY).toBe(1);
    expect({ ...proposal.command, nodeIds: proposal.command.nodeIds.map(String) }).toEqual({
      kind: 'apply-transform-delta',
      nodeIds: [FIXTURE_IDS.rectangle],
      delta: [1, 0, 0, 1, 0, 0],
    });
  }
});

test('applies the expected active axes for all eight handles', () => {
  const prepared = unwrap(
    prepareSelectionResize(baseDocument(), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  const expected: Record<ResizeHandle, [number, number]> = {
    'north-west': [0.9, 0.8],
    north: [1, 0.8],
    'north-east': [1.1, 0.8],
    east: [1.1, 1],
    'south-east': [1.1, 1.2],
    south: [1, 1.2],
    'south-west': [0.9, 1.2],
    west: [0.9, 1],
  };

  for (const entry of prepared.handles) {
    const proposal = unwrap(
      prepared.propose({
        handle: entry.handle,
        startPoint: entry.point,
        currentPoint: { x: entry.point.x + 10, y: entry.point.y + 10 },
        preserveAspectRatio: false,
        fromCenter: false,
      }),
    );
    expect([proposal.scaleX, proposal.scaleY]).toEqual(expected[entry.handle]);
  }
});

test('proposes opposite-anchor, center, constrained, and combined resize deltas', () => {
  const prepared = unwrap(
    prepareSelectionResize(baseDocument(), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );

  const corner = unwrap(
    prepared.propose({
      handle: 'south-east',
      startPoint: { x: 110, y: 70 },
      currentPoint: { x: 210, y: 120 },
      preserveAspectRatio: false,
      fromCenter: false,
    }),
  );
  expect(corner).toMatchObject({
    anchor: { x: 10, y: 20 },
    scaleX: 2,
    scaleY: 2,
    bounds: { minX: 10, minY: 20, maxX: 210, maxY: 120 },
    command: {
      kind: 'apply-transform-delta',
      nodeIds: [FIXTURE_IDS.rectangle],
      delta: [2, 0, 0, 2, -10, -20],
    },
  });

  const centered = unwrap(
    prepared.propose({
      handle: 'east',
      startPoint: { x: 110, y: 45 },
      currentPoint: { x: 160, y: 45 },
      preserveAspectRatio: false,
      fromCenter: true,
    }),
  );
  expect(centered).toMatchObject({
    anchor: { x: 60, y: 45 },
    scaleX: 2,
    scaleY: 1,
    bounds: { minX: -40, minY: 20, maxX: 160, maxY: 70 },
    command: { delta: [2, 0, 0, 1, -60, 0] },
  });

  const constrainedEdge = unwrap(
    prepared.propose({
      handle: 'north',
      startPoint: { x: 60, y: 20 },
      currentPoint: { x: 60, y: -30 },
      preserveAspectRatio: true,
      fromCenter: false,
    }),
  );
  expect(constrainedEdge).toMatchObject({
    anchor: { x: 60, y: 70 },
    scaleX: 2,
    scaleY: 2,
    bounds: { minX: -40, minY: -30, maxX: 160, maxY: 70 },
    command: { delta: [2, 0, 0, 2, -60, -70] },
  });

  const combined = unwrap(
    prepared.propose({
      handle: 'south-east',
      startPoint: { x: 110, y: 70 },
      currentPoint: { x: 135, y: 82.5 },
      preserveAspectRatio: true,
      fromCenter: true,
    }),
  );
  expect(combined).toMatchObject({
    anchor: { x: 60, y: 45 },
    scaleX: 1.5,
    scaleY: 1.5,
    bounds: { minX: -15, minY: 7.5, maxX: 135, maxY: 82.5 },
    command: { delta: [1.5, 0, 0, 1.5, -30, -22.5] },
  });
});

test('supports signed crossing and freezes detached proposal state', () => {
  const prepared = unwrap(
    prepareSelectionResize(baseDocument(), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  const startPoint = { x: 110, y: 45 };
  const currentPoint = { x: -40, y: 45 };
  const proposal = unwrap(
    prepared.propose({
      handle: 'east',
      startPoint,
      currentPoint,
      preserveAspectRatio: false,
      fromCenter: false,
    }),
  );
  startPoint.x = 999;
  currentPoint.x = 999;

  expect(proposal).toMatchObject({
    anchor: { x: 10, y: 45 },
    scaleX: -0.5,
    scaleY: 1,
    bounds: { minX: -40, minY: 20, maxX: 10, maxY: 70 },
    command: { delta: [-0.5, 0, 0, 1, 15, 0] },
  });
  expect(Object.isFrozen(proposal)).toBe(true);
  expect(Object.isFrozen(proposal.anchor)).toBe(true);
  expect(Object.isFrozen(proposal.bounds)).toBe(true);
  expect(Object.isFrozen(proposal.command)).toBe(true);
  expect(Object.isFrozen(proposal.command.nodeIds)).toBe(true);
  expect(Object.isFrozen(proposal.command.delta)).toBe(true);
});

test('preserves stable empty, invalid, hidden, locked, and cross-page failures', () => {
  const document = baseDocument();
  expect(prepareSelectionResize(document, { nodeIds: [], activeNodeId: null })).toEqual({
    ok: false,
    error: { code: 'selection.empty', path: '/nodeIds' },
  });
  expect(
    prepareSelectionResize(document, {
      nodeIds: ['not-a-uuid'],
      activeNodeId: null,
    }),
  ).toEqual({ ok: false, error: { code: 'id.invalid', path: '/nodeIds/0' } });
  expect(
    prepareSelectionResize(baseDocument({ visible: false }), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  ).toEqual({ ok: false, error: { code: 'selection.ineligible', path: '/nodeIds/0' } });
  expect(
    prepareSelectionResize(baseDocument({ locked: true }), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  ).toEqual({ ok: false, error: { code: 'selection.ineligible', path: '/nodeIds/0' } });

  const crossPage = unwrap(
    validateDocument({
      ...document,
      pageOrder: [FIXTURE_IDS.page, IDS.otherPage],
      pages: [
        { id: FIXTURE_IDS.page, name: 'Page 1', rootNodeIds: [] },
        { id: IDS.otherPage, name: 'Page 2', rootNodeIds: [FIXTURE_IDS.rectangle] },
      ],
    }),
  );
  expect(
    prepareSelectionResize(crossPage, {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  ).toEqual({ ok: false, error: { code: 'selection.page-mismatch', path: '/nodeIds/0' } });
});

test('rejects singular and overflowing proposals at stable paths', () => {
  const prepared = unwrap(
    prepareSelectionResize(baseDocument(), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  expect(
    prepared.propose({
      handle: 'east',
      startPoint: { x: 110, y: 45 },
      currentPoint: { x: 10, y: 45 },
      preserveAspectRatio: false,
      fromCenter: false,
    }),
  ).toEqual({ ok: false, error: { code: 'matrix.singular', path: '/delta' } });
  expect(
    prepared.propose({
      handle: 'east',
      startPoint: { x: -Number.MAX_VALUE, y: 45 },
      currentPoint: { x: Number.MAX_VALUE, y: 45 },
      preserveAspectRatio: false,
      fromCenter: false,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/currentPoint/x' },
  });
  expect(
    prepared.propose({
      handle: 'east',
      startPoint: { x: Number.NaN, y: 45 },
      currentPoint: { x: 110, y: 45 },
      preserveAspectRatio: false,
      fromCenter: false,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.point-invalid', path: '/startPoint/x' },
  });
});

test('reports model-bound overflow before constructing a prepared plan', () => {
  expect(
    prepareSelectionResize(
      baseDocument({ transform: [Number.MAX_VALUE, 0, 0, 1, Number.MAX_VALUE, 20] }),
      { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
    ),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/0/transform' },
  });
});

test('keeps handle midpoints finite near the maximum coordinate range', () => {
  const prepared = unwrap(
    prepareSelectionResize(
      baseDocument({
        transform: [1e285, 0, 0, 1, 1e308, 20],
        width: 10_000_000,
      }),
      { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
    ),
  );
  expect(prepared.handles.every((entry) => Number.isFinite(entry.point.x))).toBe(true);
});

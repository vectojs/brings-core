import { expect, test } from 'bun:test';
import {
  prepareSelectionAlignment,
  type BringsDocument,
  type SceneNodeInput,
  type SelectionInput,
} from '../src';
import { FIXTURE_IDS, validatedDocument } from './fixtures';

const IDS = {
  target: '77777777-7777-4777-8777-777777777777',
  secondTarget: '88888888-8888-4888-8888-888888888888',
  group: '99999999-9999-4999-8999-999999999999',
  hiddenFrame: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  hiddenChild: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  frame: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  overflowingChild: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
    stroke: null,
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

function documentWithTargets(
  targets: readonly SceneNodeInput[],
  selected: SceneNodeInput = rectangle(),
): BringsDocument {
  return validatedDocument(
    [selected, ...targets],
    [selected.id, ...targets.map((target) => target.id)],
  );
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('Expected a successful result.');
  return result.value;
}

test('prepares immutable move alignment and resolves a max-to-min snap', () => {
  const input: SelectionInput & { nodeIds: string[] } = {
    nodeIds: [FIXTURE_IDS.rectangle],
    activeNodeId: FIXTURE_IDS.rectangle,
  };
  const prepared = unwrap(
    prepareSelectionAlignment(
      documentWithTargets([rectangle({ id: IDS.target, transform: [1, 0, 0, 1, 124, 200] })]),
      input,
    ),
  );
  input.nodeIds[0] = IDS.target;

  const result = unwrap(prepared.resolveMove({ x: 13.5, y: 0 }));
  expect(result).toMatchObject({
    delta: { x: 14, y: 0 },
    guides: [
      {
        axis: 'x',
        sourceAnchor: 'max',
        targetAnchor: 'min',
        targetNodeId: IDS.target,
        coordinate: 124,
        minExtent: 20,
        maxExtent: 250,
      },
    ],
  });
  expect(prepared.selection.nodeIds.map(String)).toEqual([FIXTURE_IDS.rectangle]);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.isFrozen(prepared.selection)).toBe(true);
  expect(Object.isFrozen(prepared.selection.nodeIds)).toBe(true);
  expect(Object.isFrozen(prepared.bounds)).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.delta)).toBe(true);
  expect(Object.isFrozen(result.guides)).toBe(true);
  expect(Object.isFrozen(result.guides[0])).toBe(true);
});

test('uses an inclusive six-unit threshold and rejects farther candidates', () => {
  const prepared = unwrap(
    prepareSelectionAlignment(
      documentWithTargets([rectangle({ id: IDS.target, transform: [1, 0, 0, 1, 124, 200] })]),
      { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
    ),
  );
  expect(unwrap(prepared.resolveMove({ x: 8.001, y: 0 })).delta).toEqual({ x: 14, y: 0 });
  expect(unwrap(prepared.resolveMove({ x: 8, y: 0 })).delta).toEqual({ x: 14, y: 0 });
  expect(unwrap(prepared.resolveMove({ x: 7.999, y: 0 }))).toEqual({
    delta: { x: 7.999, y: 0 },
    guides: [],
  });
});

test('resolves every same-axis anchor pair and independent two-axis corrections', () => {
  const prepared = unwrap(
    prepareSelectionAlignment(
      documentWithTargets([
        rectangle({ id: IDS.target, transform: [1, 0, 0, 1, 159, 72], width: 100, height: 50 }),
      ]),
      { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
    ),
  );
  const result = unwrap(prepared.resolveMove({ x: 49, y: 2 }));
  expect(result.delta).toEqual({ x: 49, y: 2 });
  expect(
    result.guides.map((guide) => ({ ...guide, targetNodeId: String(guide.targetNodeId) })),
  ).toEqual([
    {
      axis: 'x',
      sourceAnchor: 'max',
      targetAnchor: 'min',
      targetNodeId: IDS.target,
      coordinate: 159,
      minExtent: 22,
      maxExtent: 122,
    },
    {
      axis: 'y',
      sourceAnchor: 'max',
      targetAnchor: 'min',
      targetNodeId: IDS.target,
      coordinate: 72,
      minExtent: 59,
      maxExtent: 259,
    },
  ]);
});

test('considers every min, center, and max source-to-target anchor pair', () => {
  const sourceAnchors = { min: 10, center: 60, max: 110 } as const;
  const targetOffsets = { min: 0, center: 18.5, max: 37 } as const;
  for (const sourceAnchor of ['min', 'center', 'max'] as const) {
    for (const targetAnchor of ['min', 'center', 'max'] as const) {
      const prepared = unwrap(
        prepareSelectionAlignment(
          documentWithTargets([
            rectangle({
              id: IDS.target,
              transform: [
                1,
                0,
                0,
                1,
                sourceAnchors[sourceAnchor] - targetOffsets[targetAnchor],
                200,
              ],
              width: 37,
            }),
          ]),
          { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
        ),
      );
      const guide = unwrap(prepared.resolveMove({ x: 0, y: 0 })).guides[0];
      expect(guide).toMatchObject({ axis: 'x', sourceAnchor, targetAnchor });
    }
  }
});

test('breaks equal candidates by root/depth-first traversal then anchor order', () => {
  const first = rectangle({ id: IDS.target, transform: [1, 0, 0, 1, 124, 200] });
  const second = rectangle({ id: IDS.secondTarget, transform: [1, 0, 0, 1, 124, 300] });
  const prepared = unwrap(
    prepareSelectionAlignment(documentWithTargets([first, second]), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  expect(String(unwrap(prepared.resolveMove({ x: 14, y: 0 })).guides[0]?.targetNodeId)).toBe(
    IDS.target,
  );

  const sameTarget = unwrap(
    prepareSelectionAlignment(
      documentWithTargets([
        rectangle({ id: IDS.target, transform: [1, 0, 0, 1, -90, 200], width: 200 }),
      ]),
      { nodeIds: [FIXTURE_IDS.rectangle], activeNodeId: FIXTURE_IDS.rectangle },
    ),
  );
  const guide = unwrap(sameTarget.resolveMove({ x: 0, y: 0 })).guides[0];
  expect(guide).toMatchObject({ sourceAnchor: 'min', targetAnchor: 'center' });
});

test('captures visible unlocked or locked targets but excludes hidden and selected subtrees', () => {
  const selectedGroup = group({ childIds: [FIXTURE_IDS.rectangle] });
  const visibleTarget = rectangle({
    id: IDS.target,
    locked: true,
    transform: [1, 0, 0, 1, 124, 200],
  });
  const hiddenFrame: SceneNodeInput = {
    id: IDS.hiddenFrame,
    type: 'frame',
    name: 'Hidden',
    parentId: null,
    visible: false,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [IDS.hiddenChild],
    width: 500,
    height: 500,
    cornerRadii: [0, 0, 0, 0],
    background: null,
    stroke: null,
    clipChildren: false,
  };
  const hiddenChild = rectangle({
    id: IDS.hiddenChild,
    parentId: IDS.hiddenFrame,
    transform: [1, 0, 0, 1, 124, 20],
  });
  const document = validatedDocument(
    [selectedGroup, rectangle({ parentId: IDS.group }), visibleTarget, hiddenFrame, hiddenChild],
    [IDS.group, IDS.target, IDS.hiddenFrame],
  );
  const prepared = unwrap(
    prepareSelectionAlignment(document, { nodeIds: [IDS.group], activeNodeId: IDS.group }),
  );
  const result = unwrap(prepared.resolveMove({ x: 14, y: 0 }));
  expect(result.guides).toHaveLength(1);
  expect(String(result.guides[0]?.targetNodeId)).toBe(IDS.target);
});

test('uses recursive Group bounds and Frame own bounds while capturing detached targets', () => {
  const selected = rectangle();
  const groupedChild = rectangle({
    id: FIXTURE_IDS.ellipse,
    parentId: IDS.group,
    transform: [1, 0, 0, 1, 40, 30],
    width: 30,
    height: 20,
  });
  const grouped = group({ transform: [2, 0, 0, 2, 10, 0], childIds: [FIXTURE_IDS.ellipse] });
  const frame: SceneNodeInput = {
    id: IDS.frame,
    type: 'frame',
    name: 'Frame',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 124, 20],
    childIds: [IDS.overflowingChild],
    width: 100,
    height: 50,
    cornerRadii: [0, 0, 0, 0],
    background: null,
    stroke: null,
    clipChildren: false,
  };
  const overflowing = rectangle({
    id: IDS.overflowingChild,
    parentId: IDS.frame,
    transform: [1, 0, 0, 1, 1000, 1000],
  });
  const document = validatedDocument(
    [selected, grouped, groupedChild, frame, overflowing],
    [selected.id, IDS.group, IDS.frame],
  );
  const prepared = unwrap(
    prepareSelectionAlignment(document, {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  const fromGroup = unwrap(prepared.resolveMove({ x: -20, y: 0 }));
  expect(fromGroup.guides.find((guide) => guide.targetNodeId === IDS.group)).toMatchObject({
    coordinate: 90,
  });
  const fromFrame = unwrap(prepared.resolveMove({ x: 14, y: 0 }));
  expect(fromFrame.guides.find((guide) => guide.targetNodeId === IDS.frame)).toMatchObject({
    coordinate: 124,
  });

  (frame.transform as number[])[4] = 400;
  expect(unwrap(prepared.resolveMove({ x: 14, y: 0 })).guides[0]?.coordinate).toBe(124);
});

test('rejects invalid or non-finite move input with a stable Result error', () => {
  const prepared = unwrap(
    prepareSelectionAlignment(documentWithTargets([]), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  expect(prepared.resolveMove({ x: Number.NaN, y: 0 })).toEqual({
    ok: false,
    error: { code: 'geometry.point-invalid', path: '/delta/x' },
  });
  expect(prepared.resolveMove(null as unknown as { x: number; y: number })).toEqual({
    ok: false,
    error: { code: 'geometry.point-invalid', path: '/delta' },
  });
});

test('leaves rotated, skewed, and flipped selection or target geometry unsnapped', () => {
  const target = rectangle({ id: IDS.target, transform: [1, 0, 0, 1, 124, 200] });
  const rotatedSource = rectangle({ transform: [0, 1, -1, 0, 10, 20] });
  const rotated = unwrap(
    prepareSelectionAlignment(documentWithTargets([target], rotatedSource), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  expect(unwrap(rotated.resolveMove({ x: 14, y: 0 }))).toEqual({
    delta: { x: 14, y: 0 },
    guides: [],
  });

  const flippedTarget = rectangle({ id: IDS.target, transform: [-1, 0, 0, 1, 224, 200] });
  const skewed = unwrap(
    prepareSelectionAlignment(documentWithTargets([flippedTarget]), {
      nodeIds: [FIXTURE_IDS.rectangle],
      activeNodeId: FIXTURE_IDS.rectangle,
    }),
  );
  expect(unwrap(skewed.resolveMove({ x: 14, y: 0 }))).toEqual({
    delta: { x: 14, y: 0 },
    guides: [],
  });
});

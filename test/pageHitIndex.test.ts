import { expect, test } from 'bun:test';
import {
  hitTestPage,
  intersectPageRect,
  validateDocument,
  type BringsDocument,
  type NodeId,
  type PageId,
  type PageRect,
  type SceneNodeInput,
  type UUID,
} from '../src';
import { createPageHitIndex } from '../src/geometry/pageHitIndex';

const ids = {
  document: '11111111-1111-4111-8111-111111111111' as UUID,
  page: '22222222-2222-4222-8222-222222222222' as PageId,
  frame: '33333333-3333-4333-8333-333333333333' as NodeId,
  rectangle: '44444444-4444-4444-8444-444444444444' as NodeId,
  ellipse: '55555555-5555-4555-8555-555555555555' as NodeId,
  text: '66666666-6666-4666-8666-666666666666' as NodeId,
  group: '77777777-7777-4777-8777-777777777777' as NodeId,
  rectangle2: '88888888-8888-4888-8888-888888888888' as NodeId,
  clip: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as NodeId,
  nestedClip: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as NodeId,
  child: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as NodeId,
  missing: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as NodeId,
} as const;

const paint = { type: 'solid', r: 0.1, g: 0.4, b: 0.8, a: 1 } as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function frame(overrides: Record<string, unknown> = {}): SceneNodeInput {
  return {
    id: ids.frame,
    type: 'frame',
    name: 'Frame',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [],
    width: 100,
    height: 100,
    cornerRadii: [0, 0, 0, 0],
    background: paint,
    stroke: null,
    clipChildren: false,
    ...overrides,
  } as SceneNodeInput;
}

function rectangle(overrides: Record<string, unknown> = {}): SceneNodeInput {
  return {
    id: ids.rectangle,
    type: 'rectangle',
    name: 'Rectangle',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 100,
    height: 100,
    cornerRadii: [0, 0, 0, 0],
    fill: paint,
    stroke: null,
    ...overrides,
  } as SceneNodeInput;
}

function ellipse(overrides: Record<string, unknown> = {}): SceneNodeInput {
  return {
    id: ids.ellipse,
    type: 'ellipse',
    name: 'Ellipse',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    width: 20,
    height: 10,
    fill: paint,
    stroke: null,
    ...overrides,
  } as SceneNodeInput;
}

function text(overrides: Record<string, unknown> = {}): SceneNodeInput {
  return {
    id: ids.text,
    type: 'text',
    name: 'Text',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    content: 'Brings',
    fontFamilies: ['sans-serif'],
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 20,
    horizontalAlign: 'left',
    layoutMode: 'fixedBox',
    width: 80,
    height: 20,
    fill: paint,
    ...overrides,
  } as SceneNodeInput;
}

function group(overrides: Record<string, unknown> = {}): SceneNodeInput {
  return {
    id: ids.group,
    type: 'group',
    name: 'Group',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [ids.rectangle],
    ...overrides,
  } as SceneNodeInput;
}

function documentWith(
  nodes: readonly SceneNodeInput[],
  rootNodeIds: readonly string[],
): BringsDocument {
  return unwrap(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Fixture',
      pageOrder: [ids.page],
      activePageId: ids.page,
      pages: [{ id: ids.page, name: 'Page 1', rootNodeIds }],
      nodes,
    }),
  );
}

function expectParity(document: BringsDocument, rects: readonly PageRect[]): void {
  const created = createPageHitIndex(document);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  for (const rect of rects) {
    expect(created.value.intersect(rect)).toEqual(intersectPageRect(document, rect));
    if (rect.width === 0 && rect.height === 0) {
      const point = { x: rect.x, y: rect.y };
      expect(created.value.hitTest(point)).toEqual(hitTestPage(document, point));
    }
  }
}

test('matches direct traversal for exact silhouettes, order, and nested clipping', () => {
  const document = documentWith(
    [
      frame({
        id: ids.clip,
        width: 100,
        height: 100,
        childIds: [ids.nestedClip],
        clipChildren: true,
      }),
      frame({
        id: ids.nestedClip,
        parentId: ids.clip,
        transform: [1, 0, 0, 1, 60, 0],
        width: 60,
        height: 100,
        childIds: [ids.child, ids.ellipse],
        clipChildren: true,
      }),
      rectangle({
        id: ids.child,
        parentId: ids.nestedClip,
        transform: [1, 0, 0, 1, 30, 10],
        width: 40,
        height: 20,
      }),
      ellipse({
        parentId: ids.nestedClip,
        transform: [2, 0.5, 0.25, 1.5, 20, 30],
        stroke: { paint, width: 4 },
      }),
      rectangle({ id: ids.rectangle2, transform: [1, 0, 0, 1, 90, 10] }),
    ],
    [ids.clip, ids.rectangle2],
  );

  expectParity(document, [
    { x: 95, y: 15, width: 0, height: 0 },
    { x: 110, y: 15, width: 0, height: 0 },
    { x: -50, y: -50, width: 300, height: 300 },
    { x: 250, y: 250, width: -300, height: -300 },
  ]);
});

test('does not omit exact descendants when conservative clip bounds are disjoint', () => {
  const document = documentWith(
    [
      frame({
        id: ids.clip,
        transform: [
          1.0644880076870322, -0.07736642565578222, 0.12247125478461385, 1.8750126101076603,
          -845444.327685982, -747405.563481152,
        ],
        width: 4309.575462248176,
        height: 8456.978374160826,
        childIds: [ids.nestedClip],
        clipChildren: true,
      }),
      frame({
        id: ids.nestedClip,
        parentId: ids.clip,
        transform: [
          0.343016360886395, 0.12618815898895264, -0.1825229679234326, 0.8579063881188631,
          -212522.2790054977, -174325.68036019802,
        ],
        width: 5580.095753539354,
        height: 1244.839821010828,
        childIds: [ids.ellipse],
      }),
      ellipse({
        parentId: ids.nestedClip,
        transform: [
          -1.3147525684908032, -0.787397631444037, -0.5703434399329126, -0.884436771273613,
          913783.8403694332, 519026.8764272332,
        ],
        width: 3469.8125813156366,
        height: 2147.5941385142505,
      }),
    ],
    [ids.clip],
  );
  const query = {
    x: -7.168684201315046e148,
    y: -6.856599356979123e148,
    width: 6.61689188797027e149,
    height: 6.691183168441058e149,
  } as const;
  const direct = intersectPageRect(document, query);
  expect(direct).toEqual({ ok: true, value: [ids.clip, ids.ellipse] });

  const created = createPageHitIndex(document);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.value.intersect(query)).toEqual(direct);
});

test('matches the direct oracle across established silhouettes, traversal, and errors', () => {
  const cosine = Math.SQRT1_2;
  const hidden = documentWith([rectangle({ visible: false })], [ids.rectangle]);
  const locked = documentWith([rectangle({ locked: true })], [ids.rectangle]);
  const validSingular = documentWith(
    [frame({ childIds: [ids.rectangle] }), rectangle({ parentId: ids.frame })],
    [ids.frame],
  );
  const singular = {
    ...validSingular,
    nodes: validSingular.nodes.map((node, index) =>
      index === 0 ? { ...node, transform: [1, 0, 0, 0, 0, 0] as const } : node,
    ),
  } as BringsDocument;
  const siblings = documentWith(
    [
      rectangle({ width: 80, height: 80 }),
      rectangle({ id: ids.rectangle2, width: 80, height: 80 }),
    ],
    [ids.rectangle, ids.rectangle2],
  );
  const affine = [1, 0.5, 0.25, 1, 100, 50] as const;
  const affineClip = documentWith(
    [
      frame({
        transform: affine,
        childIds: [ids.rectangle],
        stroke: { paint, width: 20 },
        clipChildren: true,
      }),
      rectangle({
        parentId: ids.frame,
        transform: [1, 0, 0, 1, 80, 40],
        width: 40,
        height: 20,
        stroke: { paint, width: 4 },
      }),
    ],
    [ids.frame],
  );
  const validMissingChild = documentWith(
    [frame({ childIds: [ids.rectangle], clipChildren: true }), rectangle({ parentId: ids.frame })],
    [ids.frame],
  );
  const missingChild = {
    ...validMissingChild,
    nodes: validMissingChild.nodes.map((node, index) =>
      index === 0 ? { ...node, childIds: [ids.missing] } : node,
    ),
  } as BringsDocument;
  const laterOverflow = documentWith(
    [
      rectangle({ width: 20, height: 20 }),
      rectangle({
        id: ids.rectangle2,
        transform: [Number.MAX_VALUE, 0, 0, 1, Number.MAX_VALUE, 0],
        width: 2,
        height: 1,
      }),
    ],
    [ids.rectangle, ids.rectangle2],
  );

  const cases: readonly Readonly<{
    name: string;
    document: BringsDocument;
    rect: PageRect;
  }>[] = [
    {
      name: 'measured Text box',
      document: documentWith([text({ transform: [1, 0, 0, 1, 200, 20] })], [ids.text]),
      rect: { x: 210, y: 25, width: 0, height: 0 },
    },
    { name: 'hidden node', document: hidden, rect: { x: 0, y: 0, width: 500, height: 500 } },
    { name: 'locked node', document: locked, rect: { x: 0, y: 0, width: 500, height: 500 } },
    {
      name: 'singular subtree',
      document: singular,
      rect: { x: 0, y: 0, width: 500, height: 500 },
    },
    {
      name: 'rotated AABB-only miss',
      document: documentWith(
        [
          rectangle({
            transform: [cosine, cosine, -cosine, cosine, 100, 0],
            width: 100,
            height: 100,
          }),
        ],
        [ids.rectangle],
      ),
      rect: { x: 29.3, y: 0, width: 1, height: 1 },
    },
    {
      name: 'overlapping sibling order',
      document: siblings,
      rect: { x: 20, y: 20, width: 10, height: 10 },
    },
    {
      name: 'affine clipped centered stroke',
      document: affineClip,
      rect: {
        x: affine[0] * 78 + affine[2] * 50 + affine[4],
        y: affine[1] * 78 + affine[3] * 50 + affine[5],
        width: 0,
        height: 0,
      },
    },
    {
      name: 'deferred missing-child error',
      document: missingChild,
      rect: { x: 1, y: 1, width: 0, height: 0 },
    },
    {
      name: 'later exact-computation error',
      document: laterOverflow,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    },
  ];

  for (const fixture of cases) {
    const direct = intersectPageRect(fixture.document, fixture.rect);
    const created = createPageHitIndex(fixture.document);
    expect(created.ok, fixture.name).toBe(true);
    if (!created.ok) continue;
    expect(created.value.intersect(fixture.rect), fixture.name).toEqual(direct);
    if (fixture.rect.width === 0 && fixture.rect.height === 0) {
      const point = { x: fixture.rect.x, y: fixture.rect.y };
      expect(created.value.hitTest(point), fixture.name).toEqual(
        hitTestPage(fixture.document, point),
      );
    }
  }
});

test('returns fresh frozen results from one reusable index', () => {
  const document = documentWith(
    [
      rectangle({ id: ids.rectangle, transform: [1, 0, 0, 1, 0, 0] }),
      rectangle({ id: ids.rectangle2, transform: [1, 0, 0, 1, 20, 20] }),
    ],
    [ids.rectangle, ids.rectangle2],
  );
  const created = createPageHitIndex(document);
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const query = { x: 25, y: 25, width: 0, height: 0 } as const;
  const first = created.value.intersect(query);
  const second = created.value.intersect(query);
  expect(first).toEqual(second);
  expect(first === second).toBe(false);
  if (first.ok && second.ok) {
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(first.value === second.value).toBe(false);
  }
  expect(Object.isFrozen(created.value)).toBe(true);

  const firstHit = created.value.hitTest({ x: 25, y: 25 });
  const secondHit = created.value.hitTest({ x: 25, y: 25 });
  expect(firstHit).toEqual([ids.rectangle2, ids.rectangle]);
  expect(Object.isFrozen(firstHit)).toBe(true);
  expect(firstHit === secondHit).toBe(false);
});

test('returns a fresh frozen empty point result for invalid points and query failures', () => {
  const created = createPageHitIndex(documentWith([rectangle()], [ids.rectangle]));
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  for (const point of [
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
  ]) {
    const first = created.value.hitTest(point);
    const second = created.value.hitTest(point);
    expect(first).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first === second).toBe(false);
  }
});

test('fails index preparation when no query can reach a valid active-page traversal', () => {
  const valid = documentWith([], []);
  const missingActivePage = { ...valid, activePageId: ids.missing } as unknown as BringsDocument;
  const first = createPageHitIndex(missingActivePage);
  const second = createPageHitIndex(missingActivePage);
  expect(first).toEqual({
    ok: false,
    error: { code: 'geometry.active-page-not-found', path: '/activePageId' },
  });
  expect(first === second).toBe(false);
  if (!first.ok && !second.ok) {
    expect(Object.isFrozen(first.error)).toBe(true);
    expect(first.error === second.error).toBe(false);
  }
});

test('executes clipping frames for empty, line, point, and extreme finite queries', () => {
  const valid = documentWith(
    [
      frame({
        id: ids.clip,
        transform: [1, 0, 0, 1, 10_000, 10_000],
        width: 1,
        height: 100,
        childIds: [ids.nestedClip],
        clipChildren: true,
      }),
      frame({
        id: ids.nestedClip,
        parentId: ids.clip,
        width: 100,
        height: 1,
        childIds: [ids.child],
        clipChildren: true,
      }),
      rectangle({ id: ids.child, parentId: ids.nestedClip, width: 10, height: 10 }),
    ],
    [ids.clip],
  );
  const document = {
    ...valid,
    nodes: valid.nodes.map((node, index) =>
      index === 0 ? { ...node, width: 0 } : index === 1 ? { ...node, height: 0 } : node,
    ),
  } as BringsDocument;

  expectParity(document, [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 10_000, y: 10_000, width: 0, height: 0 },
    { x: -Number.MAX_VALUE / 4, y: -1, width: Number.MAX_VALUE / 2, height: 2 },
  ]);
});

test('keeps immediate topology errors active outside a frame own clip', () => {
  const valid = documentWith(
    [
      frame({ width: 10, height: 10, childIds: [ids.rectangle], clipChildren: true }),
      rectangle({ parentId: ids.frame }),
    ],
    [ids.frame],
  );
  const malformed = {
    ...valid,
    nodes: valid.nodes.map((node, index) =>
      index === 0 ? { ...node, childIds: [ids.missing] } : node,
    ),
  } as BringsDocument;
  const expected = intersectPageRect(malformed, { x: 1_000, y: 1_000, width: 1, height: 1 });
  expect(expected).toEqual({
    ok: false,
    error: { code: 'geometry.document-invariant', path: '/nodes/0/childIds/0' },
  });

  const created = createPageHitIndex(malformed);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const actual = created.value.intersect({ x: 1_000, y: 1_000, width: 1, height: 1 });
  expect(actual).toEqual(expected);
  expect(actual.ok).toBe(false);
  if (!actual.ok) expect(Object.isFrozen(actual.error)).toBe(true);

  const mismatched = {
    ...valid,
    nodes: valid.nodes.map((node, index) => (index === 1 ? { ...node, parentId: null } : node)),
  } as BringsDocument;
  const mismatchIndex = createPageHitIndex(mismatched);
  expect(mismatchIndex.ok).toBe(true);
  if (!mismatchIndex.ok) return;
  expect(mismatchIndex.value.intersect({ x: 1_000, y: 1_000, width: 1, height: 1 })).toEqual(
    intersectPageRect(mismatched, { x: 1_000, y: 1_000, width: 1, height: 1 }),
  );
});

test('does not activate deeper malformed descendants behind an empty clip chain', () => {
  const valid = documentWith(
    [
      frame({ width: 10, height: 10, childIds: [ids.group], clipChildren: true }),
      group({ parentId: ids.frame, childIds: [ids.rectangle] }),
      rectangle({ parentId: ids.group }),
    ],
    [ids.frame],
  );
  const malformed = {
    ...valid,
    nodes: valid.nodes.map((node, index) =>
      index === 1 ? { ...node, childIds: [ids.missing] } : node,
    ),
  } as BringsDocument;
  const outside = { x: 1_000, y: 1_000, width: 1, height: 1 } as const;
  expect(intersectPageRect(malformed, outside)).toEqual({ ok: true, value: [] });

  const created = createPageHitIndex(malformed);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.value.intersect(outside)).toEqual({ ok: true, value: [] });
  expect(created.value.intersect({ x: 1, y: 1, width: 0, height: 0 })).toEqual(
    intersectPageRect(malformed, { x: 1, y: 1, width: 0, height: 0 }),
  );
});

test('preserves query-time clip overflow before a later global terminal error', () => {
  const valid = documentWith(
    [
      frame({
        id: ids.clip,
        width: 10_000_000,
        height: 10_000_000,
        childIds: [],
        clipChildren: true,
      }),
      rectangle({ id: ids.rectangle2, transform: [1, 0, 0, 1, 20, 20] }),
    ],
    [ids.clip, ids.rectangle2],
  );
  const malformed = {
    ...valid,
    pages: [{ ...valid.pages[0]!, rootNodeIds: [ids.clip, ids.rectangle2, ids.missing] }],
  } as BringsDocument;
  const created = createPageHitIndex(malformed);
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const ordinaryMiss = { x: 20_000_000, y: 20_000_000, width: 1, height: 1 } as const;
  expect(created.value.intersect(ordinaryMiss)).toEqual({
    ok: false,
    error: { code: 'geometry.document-invariant', path: '/pages/0/rootNodeIds/2' },
  });
  expect(created.value.intersect(ordinaryMiss)).toEqual(intersectPageRect(malformed, ordinaryMiss));

  const overflowingMiss = {
    x: Number.MAX_VALUE - 1,
    y: Number.MAX_VALUE - 1,
    width: 0,
    height: 0,
  } as const;
  expect(created.value.intersect(overflowingMiss)).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/0/transform' },
  });
  expect(created.value.intersect(overflowingMiss)).toEqual(
    intersectPageRect(malformed, overflowingMiss),
  );
});

test('detaches prepared geometry and errors from caller-owned document values', () => {
  const clipped = documentWith(
    [
      frame({ width: 10, height: 10, childIds: [ids.rectangle], clipChildren: true }),
      rectangle({ parentId: ids.frame, transform: [1, 0, 0, 1, 5, 0], width: 10, height: 10 }),
    ],
    [ids.frame],
  );
  const clippedIndex = createPageHitIndex(clipped);
  expect(clippedIndex.ok).toBe(true);
  if (!clippedIndex.ok) return;
  (clipped.nodes[0] as unknown as { width: number }).width = 20;
  (clipped.nodes[1]!.transform as unknown as number[])[4] = 100;
  expect(clippedIndex.value.intersect({ x: 12, y: 5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [],
  });
  expect(clippedIndex.value.intersect({ x: 8, y: 5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.frame, ids.rectangle],
  });

  const valid = documentWith(
    [
      rectangle({ width: 20, height: 20 }),
      rectangle({ id: ids.rectangle2, width: 20, height: 20 }),
    ],
    [ids.rectangle, ids.rectangle2],
  );
  const malformed = {
    ...valid,
    pages: [{ ...valid.pages[0]!, rootNodeIds: [ids.rectangle, ids.rectangle2, ids.missing] }],
  } as BringsDocument;
  const created = createPageHitIndex(malformed);
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const mutableTransform = valid.nodes[0]!.transform as unknown as number[];
  mutableTransform[4] = 10_000;
  const first = created.value.intersect({ x: 1, y: 1, width: 0, height: 0 });
  const second = created.value.intersect({ x: 1, y: 1, width: 0, height: 0 });
  expect(first).toEqual(second);
  expect(first.ok).toBe(false);
  if (!first.ok && !second.ok) {
    expect(Object.isFrozen(first.error)).toBe(true);
    expect(first.error === second.error).toBe(false);
  }
  const failedHit = created.value.hitTest({ x: 1, y: 1 });
  expect(failedHit).toEqual([]);
  expect(Object.isFrozen(failedHit)).toBe(true);
});

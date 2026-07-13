import { expect, test } from 'bun:test';
import {
  hitTestPage,
  intersectPageRect,
  validateDocument,
  type BringsDocument,
  type NodeId,
  type PageRect,
  type PageId,
  type SceneNodeInput,
  type UUID,
} from '../src';

const ids = {
  document: '11111111-1111-4111-8111-111111111111' as UUID,
  page: '22222222-2222-4222-8222-222222222222' as PageId,
  frame: '33333333-3333-4333-8333-333333333333' as NodeId,
  rectangle: '44444444-4444-4444-8444-444444444444' as NodeId,
  ellipse: '55555555-5555-4555-8555-555555555555' as NodeId,
  text: '66666666-6666-4666-8666-666666666666' as NodeId,
  group: '77777777-7777-4777-8777-777777777777' as NodeId,
  rectangle2: '88888888-8888-4888-8888-888888888888' as NodeId,
  page2: '99999999-9999-4999-8999-999999999999' as PageId,
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

function nestedDocument(
  frameOverrides: Record<string, unknown> = {},
  rectangleOverrides: Record<string, unknown> = {},
): BringsDocument {
  return documentWith(
    [
      frame({
        transform: [1, 0, 0, 1, 40, 50],
        width: 200,
        height: 150,
        childIds: [ids.rectangle],
        ...frameOverrides,
      }),
      rectangle({
        parentId: ids.frame,
        transform: [1, 0, 0, 1, 20, 30],
        width: 100,
        height: 80,
        ...rectangleOverrides,
      }),
    ],
    [ids.frame],
  );
}

function plainIds(value: readonly unknown[]): readonly unknown[] {
  return [...value];
}

test('returns rectangle intersections back-to-front and point hits front-to-back', () => {
  const document = nestedDocument();
  const rect: PageRect = { x: 35, y: 45, width: 140, height: 120 };
  const documentBefore = JSON.stringify(document);
  const rectBefore = JSON.stringify(rect);

  expect(intersectPageRect(document, rect)).toEqual({
    ok: true,
    value: [ids.frame, ids.rectangle],
  });
  expect(intersectPageRect(document, { x: 175, y: 165, width: -140, height: -120 })).toEqual({
    ok: true,
    value: [ids.frame, ids.rectangle],
  });
  expect(hitTestPage(document, { x: 80, y: 100 })).toEqual([ids.rectangle, ids.frame]);
  expect(JSON.stringify(document)).toBe(documentBefore);
  expect(JSON.stringify(rect)).toBe(rectBefore);
});

test('includes edge, corner, line, and point contact but rejects an AABB-only rotated overlap', () => {
  const axisAligned = documentWith(
    [rectangle({ transform: [1, 0, 0, 1, 10, 10], width: 20, height: 20 })],
    [ids.rectangle],
  );
  expect(intersectPageRect(axisAligned, { x: 30, y: 30, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.rectangle],
  });
  expect(intersectPageRect(axisAligned, { x: 30, y: 15, width: 0, height: 10 })).toEqual({
    ok: true,
    value: [ids.rectangle],
  });
  expect(intersectPageRect(axisAligned, { x: 31, y: 15, width: 0, height: 10 })).toEqual({
    ok: true,
    value: [],
  });

  const cosine = Math.SQRT1_2;
  const rotated = documentWith(
    [
      rectangle({
        transform: [cosine, cosine, -cosine, cosine, 100, 0],
        width: 100,
        height: 100,
      }),
    ],
    [ids.rectangle],
  );
  expect(intersectPageRect(rotated, { x: 29.3, y: 0, width: 1, height: 1 })).toEqual({
    ok: true,
    value: [],
  });
  expect(intersectPageRect(rotated, { x: 100, y: 70, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.rectangle],
  });
});

test('uses exact affine ellipse geometry for misses, tangency, containment, and centered strokes', () => {
  const plain = documentWith([ellipse()], [ids.ellipse]);
  expect(intersectPageRect(plain, { x: 19.5, y: 0.5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [],
  });
  expect(intersectPageRect(plain, { x: 20, y: 5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.ellipse],
  });
  expect(intersectPageRect(plain, { x: -5, y: -5, width: 30, height: 20 })).toEqual({
    ok: true,
    value: [ids.ellipse],
  });

  const affine = documentWith([ellipse({ transform: [2, 0.5, 0.5, 1.5, 40, 30] })], [ids.ellipse]);
  expect(intersectPageRect(affine, { x: 62.5, y: 42.5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.ellipse],
  });

  const stroked = documentWith([ellipse({ stroke: { paint, width: 4 } })], [ids.ellipse]);
  expect(intersectPageRect(stroked, { x: 22, y: 5, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.ellipse],
  });
  expect(hitTestPage(stroked, { x: 22, y: 5 })).toEqual([ids.ellipse]);
});

test('selects Text and transparent nodes while traversing Groups without a silhouette', () => {
  const document = documentWith(
    [
      frame({
        opacity: 0,
        background: null,
        childIds: [ids.group],
      }),
      group({
        parentId: ids.frame,
        transform: [1, 0, 0, 1, 10, 10],
      }),
      rectangle({
        parentId: ids.group,
        transform: [1, 0, 0, 1, 20, 0],
        width: 20,
        height: 20,
        opacity: 0,
        fill: null,
      }),
      text({ transform: [1, 0, 0, 1, 200, 20], opacity: 0 }),
    ],
    [ids.frame, ids.text],
  );

  expect(intersectPageRect(document, { x: 0, y: 0, width: 300, height: 120 })).toEqual({
    ok: true,
    value: [ids.frame, ids.rectangle, ids.text],
  });
  expect(hitTestPage(document, { x: 35, y: 15 })).toEqual([ids.rectangle, ids.frame]);
  expect(hitTestPage(document, { x: 210, y: 25 })).toEqual([ids.text]);
});

test('excludes hidden, locked, inactive-page, and singular subtrees', () => {
  expect(
    intersectPageRect(nestedDocument({ visible: false }), { x: 0, y: 0, width: 500, height: 500 }),
  ).toEqual({ ok: true, value: [] });
  expect(
    intersectPageRect(nestedDocument({ locked: true }), { x: 0, y: 0, width: 500, height: 500 }),
  ).toEqual({ ok: true, value: [] });

  const inactive = unwrap(
    validateDocument({
      id: ids.document,
      revision: 0,
      name: 'Two pages',
      pageOrder: [ids.page, ids.page2],
      activePageId: ids.page,
      pages: [
        { id: ids.page, name: 'Page 1', rootNodeIds: [] },
        { id: ids.page2, name: 'Page 2', rootNodeIds: [ids.rectangle] },
      ],
      nodes: [rectangle()],
    }),
  );
  expect(intersectPageRect(inactive, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
    ok: true,
    value: [],
  });

  const valid = nestedDocument();
  const singular = {
    ...valid,
    nodes: valid.nodes.map((node, index) =>
      index === 0 ? { ...node, transform: [1, 0, 0, 0, 40, 50] as const } : node,
    ),
  } as BringsDocument;
  expect(intersectPageRect(singular, { x: 0, y: 0, width: 500, height: 500 })).toEqual({
    ok: true,
    value: [],
  });
});

test('clips descendants through transformed and nested clipping Frames', () => {
  const transformedClip = documentWith(
    [
      frame({
        id: ids.clip,
        transform: [1, 0, 0, 1, 100, 100],
        width: 50,
        height: 50,
        childIds: [ids.child],
        clipChildren: true,
      }),
      rectangle({
        id: ids.child,
        parentId: ids.clip,
        transform: [1, 0, 0, 1, 40, 10],
        width: 30,
        height: 20,
      }),
    ],
    [ids.clip],
  );
  expect(intersectPageRect(transformedClip, { x: 145, y: 115, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.clip, ids.child],
  });
  expect(intersectPageRect(transformedClip, { x: 160, y: 115, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [],
  });

  const nested = documentWith(
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
        childIds: [ids.child],
        clipChildren: true,
      }),
      rectangle({
        id: ids.child,
        parentId: ids.nestedClip,
        transform: [1, 0, 0, 1, 30, 10],
        width: 40,
        height: 20,
      }),
    ],
    [ids.clip],
  );
  expect(intersectPageRect(nested, { x: 95, y: 15, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [ids.clip, ids.nestedClip, ids.child],
  });
  expect(intersectPageRect(nested, { x: 110, y: 15, width: 0, height: 0 })).toEqual({
    ok: true,
    value: [],
  });
});

test('keeps raw parent and child hits in stable paint order', () => {
  const document = nestedDocument();
  const area = intersectPageRect(document, { x: 80, y: 100, width: 0, height: 0 });

  expect(area).toEqual({ ok: true, value: [ids.frame, ids.rectangle] });
  expect(hitTestPage(document, { x: 80, y: 100 })).toEqual([ids.rectangle, ids.frame]);
});

test('returns stable rectangle validation and endpoint-overflow errors', () => {
  const document = documentWith([], []);
  const invalidCases = [
    [{ x: Number.NaN, y: 0, width: 1, height: 1 }, '/rect/x'],
    [{ x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 }, '/rect/y'],
    [{ x: 0, y: 0, width: Number.NEGATIVE_INFINITY, height: 1 }, '/rect/width'],
    [{ x: 0, y: 0, width: 1, height: Number.NaN }, '/rect/height'],
  ] as const;
  for (const [rect, path] of invalidCases) {
    expect(intersectPageRect(document, rect)).toEqual({
      ok: false,
      error: { code: 'geometry.rect-invalid', path },
    });
  }
  expect(
    intersectPageRect(document, { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.rect-overflow', path: '/rect/width' },
  });
  expect(
    intersectPageRect(document, {
      x: 0,
      y: -Number.MAX_VALUE,
      width: 1,
      height: -Number.MAX_VALUE,
    }),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.rect-overflow', path: '/rect/height' },
  });
});

test('returns stable malformed-document paths and point-hit compatibility', () => {
  const valid = nestedDocument();
  const missingActivePage = {
    ...valid,
    activePageId: ids.missing,
  } as unknown as BringsDocument;
  expect(intersectPageRect(missingActivePage, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
    ok: false,
    error: { code: 'geometry.active-page-not-found', path: '/activePageId' },
  });
  expect(hitTestPage(missingActivePage, { x: 0, y: 0 })).toEqual([]);

  const missingRoot = {
    ...valid,
    pages: [{ ...valid.pages[0]!, rootNodeIds: [ids.missing] }],
  } as unknown as BringsDocument;
  expect(intersectPageRect(missingRoot, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
    ok: false,
    error: {
      code: 'geometry.document-invariant',
      path: '/pages/0/rootNodeIds/0',
    },
  });

  const missingChild = {
    ...valid,
    nodes: valid.nodes.map((node, index) =>
      index === 0 ? { ...node, childIds: [ids.missing] } : node,
    ),
  } as BringsDocument;
  expect(intersectPageRect(missingChild, { x: 0, y: 0, width: 500, height: 500 })).toEqual({
    ok: false,
    error: { code: 'geometry.document-invariant', path: '/nodes/0/childIds/0' },
  });

  const mismatchedParent = {
    ...valid,
    nodes: valid.nodes.map((node, index) => (index === 1 ? { ...node, parentId: null } : node)),
  } as BringsDocument;
  expect(intersectPageRect(mismatchedParent, { x: 0, y: 0, width: 500, height: 500 })).toEqual({
    ok: false,
    error: { code: 'geometry.document-invariant', path: '/nodes/1/parentId' },
  });
});

test('aborts atomically on composed-transform and exact-computation overflow', () => {
  const composed = documentWith(
    [
      group({ transform: [Number.MAX_VALUE, 0, 0, 1, 0, 0] }),
      rectangle({
        parentId: ids.group,
        transform: [Number.MAX_VALUE, 0, 0, 1, 0, 0],
        width: 1,
        height: 1,
      }),
    ],
    [ids.group],
  );
  expect(intersectPageRect(composed, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/1/transform' },
  });

  const exact = documentWith(
    [
      rectangle({
        transform: [Number.MAX_VALUE, 0, 0, 1, Number.MAX_VALUE, 0],
        width: 2,
        height: 1,
      }),
    ],
    [ids.rectangle],
  );
  const before = JSON.stringify(exact);
  const result = intersectPageRect(exact, { x: 0, y: 0, width: 1, height: 1 });
  expect(result).toEqual({
    ok: false,
    error: { code: 'geometry.computation-overflow', path: '/nodes/0/transform' },
  });
  expect(JSON.stringify(exact)).toBe(before);
  expect(hitTestPage(exact, { x: 0, y: 0 })).toEqual([]);
});

test('does not expose mutable query result aliases', () => {
  const document = nestedDocument();
  const first = intersectPageRect(document, { x: 0, y: 0, width: 500, height: 500 });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const mutable = first.value as unknown as string[];
  mutable.splice(0, mutable.length);

  const second = intersectPageRect(document, { x: 0, y: 0, width: 500, height: 500 });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(plainIds(second.value)).toEqual([ids.frame, ids.rectangle]);
});

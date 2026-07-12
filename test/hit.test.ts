import { expect, test } from 'bun:test';
import { createDocument, hitTestPage, type BringsDocument } from '../src';
import { planCommand } from '../src/document/plan';
import { validateDocument } from '../src/document/validate';

const ids = {
  document: '11111111-1111-4111-8111-111111111111',
  page: '22222222-2222-4222-8222-222222222222',
  frame: '33333333-3333-4333-8333-333333333333',
  rectangle: '44444444-4444-4444-8444-444444444444',
} as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function documentWithNestedShape(
  frameProperties: Partial<{ clipChildren: boolean; visible: boolean; locked: boolean }> = {},
): BringsDocument {
  const initial = unwrap(
    createDocument({
      id: ids.document,
      name: 'Untitled',
      initialPage: { id: ids.page, name: 'Page 1' },
    }),
  );
  const content = unwrap(
    planCommand(initial, {
      kind: 'insert-subtree',
      pageId: ids.page,
      parentId: null,
      index: 0,
      rootId: ids.frame,
      nodes: [
        {
          id: ids.frame,
          type: 'frame',
          name: 'Frame',
          parentId: null,
          visible: frameProperties.visible ?? true,
          locked: frameProperties.locked ?? false,
          opacity: 1,
          transform: [1, 0, 0, 1, 40, 50],
          childIds: [ids.rectangle],
          width: 200,
          height: 150,
          cornerRadii: [0, 0, 0, 0],
          background: { type: 'solid', r: 1, g: 1, b: 1, a: 1 },
          stroke: null,
          clipChildren: frameProperties.clipChildren ?? false,
        },
        {
          id: ids.rectangle,
          type: 'rectangle',
          name: 'Rectangle',
          parentId: ids.frame,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 20, 30],
          width: 100,
          height: 80,
          cornerRadii: [0, 0, 0, 0],
          fill: { type: 'solid', r: 0, g: 0.5, b: 1, a: 1 },
          stroke: null,
        },
      ],
    }),
  );
  return unwrap(validateDocument({ id: initial.id, revision: 1, ...content }));
}

test('returns nested painted nodes ahead of their Frame container in page-space order', () => {
  const document = documentWithNestedShape();
  expect(hitTestPage(document, { x: 80, y: 100 }).map((id) => id as string)).toEqual([
    ids.rectangle,
    ids.frame,
  ]);
  expect(hitTestPage(document, { x: 45, y: 55 }).map((id) => id as string)).toEqual([ids.frame]);
});

test('excludes locked and clipping-ineligible subtrees', () => {
  expect(hitTestPage(documentWithNestedShape({ locked: true }), { x: 80, y: 100 })).toEqual([]);
  const clipped = documentWithNestedShape({ clipChildren: true });
  expect(hitTestPage(clipped, { x: 280, y: 100 })).toEqual([]);
});

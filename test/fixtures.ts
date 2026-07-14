import { validateDocument, type BringsDocument, type SceneNodeInput } from '../src';

export const FIXTURE_IDS = {
  document: '11111111-1111-4111-8111-111111111111',
  page: '22222222-2222-4222-8222-222222222222',
  frame: '33333333-3333-4333-8333-333333333333',
  rectangle: '44444444-4444-4444-8444-444444444444',
  ellipse: '55555555-5555-4555-8555-555555555555',
  text: '66666666-6666-4666-8666-666666666666',
} as const;

export function validatedDocument(
  nodes: readonly SceneNodeInput[],
  rootNodeIds: readonly string[],
): BringsDocument {
  const result = validateDocument({
    id: FIXTURE_IDS.document,
    revision: 0,
    name: 'Fixture',
    pageOrder: [FIXTURE_IDS.page],
    activePageId: FIXTURE_IDS.page,
    pages: [{ id: FIXTURE_IDS.page, name: 'Page 1', rootNodeIds }],
    nodes,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

import { expect, test } from 'bun:test';
import { BRINGS_SCHEMA_VERSION, createDocumentStore, isOpaqueId } from '../src/index';

test('exports the schema-v1 vocabulary without a browser runtime', () => {
  expect(BRINGS_SCHEMA_VERSION).toBe(1);
  expect(isOpaqueId('a1b2c3d4')).toBe(true);
  expect(isOpaqueId('')).toBe(false);
});

test('creates a document store without browser or VectoJS globals', () => {
  expect(
    createDocumentStore({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Untitled',
      initialPage: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Page 1',
      },
    }),
  ).toMatchObject({
    ok: true,
  });
});

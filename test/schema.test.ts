import { expect, test } from 'bun:test';
import {
  BRINGS_SCHEMA_VERSION,
  createDocumentStore,
  isOpaqueId,
  type PathNetworkInput,
} from '../src/index';

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

test('exports JSON-compatible Path graph input types without a renderer dependency', () => {
  const network: PathNetworkInput = {
    vertices: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', position: { x: 0, y: 0 } },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', position: { x: 80, y: 40 } },
    ],
    segments: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        startVertexId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        endVertexId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        startControl: { x: 20, y: 0 },
        endControl: { x: -20, y: 0 },
      },
    ],
  };

  expect(network.segments[0]?.startControl).toEqual({ x: 20, y: 0 });
});

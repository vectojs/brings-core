import { expect, test } from 'bun:test';
import { BRINGS_SCHEMA_VERSION, isOpaqueId } from '../src/index';

test('exports the schema-v1 vocabulary without a browser runtime', () => {
  expect(BRINGS_SCHEMA_VERSION).toBe(1);
  expect(isOpaqueId('a1b2c3d4')).toBe(true);
  expect(isOpaqueId('')).toBe(false);
});

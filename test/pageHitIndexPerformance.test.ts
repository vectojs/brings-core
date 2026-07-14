import { expect, test } from 'bun:test';
import {
  intersectPageRect,
  validateDocument,
  type BringsDocument,
  type NodeId,
  type PageId,
  type SceneNodeInput,
  type UUID,
} from '../src';
import { createPageHitIndex, inspectPageHitIndex } from '../src/geometry/pageHitIndex';

const NODE_COUNT = 100_000;
const documentId = '10000000-0000-4000-8000-000000000000' as UUID;
const pageId = '20000000-0000-4000-8000-000000000000' as PageId;
const paint = { type: 'solid', r: 0, g: 0, b: 0, a: 1 } as const;

function nodeId(index: number): NodeId {
  return `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}` as NodeId;
}

function validatedFlatDocument(width: number): BringsDocument {
  const rootNodeIds = Array.from({ length: NODE_COUNT }, (_, index) => nodeId(index));
  const nodes: SceneNodeInput[] = rootNodeIds.map((id, index) => ({
    id,
    type: 'rectangle',
    name: 'Indexed rectangle',
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, index * 1_024, 100],
    width,
    height: 4,
    cornerRadii: [0, 0, 0, 0],
    fill: paint,
    stroke: null,
  }));
  const result = validateDocument({
    id: documentId,
    revision: 0,
    name: '100k page-hit fixture',
    pageOrder: [pageId],
    activePageId: pageId,
    pages: [{ id: pageId, name: 'Page', rootNodeIds }],
    nodes,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

test('retrieves a miss and one local candidate from a 100,000-node production index', () => {
  const document = validatedFlatDocument(4);
  const created = createPageHitIndex(document);
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const miss = inspectPageHitIndex(created.value, {
    x: -600,
    y: 101,
    width: 0,
    height: 0,
  });
  expect(miss.result).toEqual({ ok: true, value: [] });
  expect(miss.metrics).toEqual({
    cellIterations: 1,
    bucketReferencesRead: 0,
    uniqueAabbChecks: 0,
    narrowPhaseCalls: 0,
    clipOperations: 0,
    usedScanFallback: false,
  });

  const local = inspectPageHitIndex(created.value, {
    x: 1,
    y: 101,
    width: 0,
    height: 0,
  });
  expect(local.result).toEqual({ ok: true, value: [nodeId(0)] });
  expect(local.metrics).toEqual({
    cellIterations: 1,
    bucketReferencesRead: 1,
    uniqueAabbChecks: 1,
    narrowPhaseCalls: 1,
    clipOperations: 0,
    usedScanFallback: false,
  });
  expect(local.indexStats.mode).toBe('hash');
}, 120_000);

test('atomically discards a 100,000-node hash after exceeding the production reference cap', () => {
  const document = validatedFlatDocument(512 * 10 + 1);
  const created = createPageHitIndex(document);
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const rect = { x: 1, y: 101, width: 0, height: 0 } as const;
  const inspected = inspectPageHitIndex(created.value, rect);
  expect(inspected.indexStats).toMatchObject({
    mode: 'scan',
    bucketCount: 0,
    referenceCount: 0,
  });
  expect(inspected.metrics.usedScanFallback).toBe(true);
  expect(inspected.result).toEqual(intersectPageRect(document, rect));
}, 120_000);

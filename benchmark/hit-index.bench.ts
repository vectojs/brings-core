import {
  createPageHitIndex,
  intersectPageRect,
  validateDocument,
  type BringsDocument,
  type NodeId,
  type PageId,
  type PageRect,
  type Result,
  type SceneNodeInput,
  type UUID,
} from '../src';
import { inspectPageHitIndex, type PageHitQueryMetrics } from '../src/geometry/pageHitIndex';

const NODE_COUNT = 100_000;
const INDEX_WARMUP_QUERIES = 100;
const INDEX_TIMED_QUERIES = 1_000;
const DIRECT_TIMED_QUERIES = 30;
const PROCESS_RUNS = 5;
const MAX_INDEX_RSS_DELTA_BYTES = 192 * 1024 * 1024;
const MINIMUM_SPEEDUP = 4;

const documentId = '10000000-0000-4000-8000-000000000000' as UUID;
const pageId = '20000000-0000-4000-8000-000000000000' as PageId;
const paint = { type: 'solid', r: 0, g: 0, b: 0, a: 1 } as const;

const QUERY_KINDS = Object.freeze([
  Object.freeze({ name: 'miss', rect: Object.freeze({ x: -600, y: 101, width: 0, height: 0 }) }),
  Object.freeze({ name: 'local', rect: Object.freeze({ x: 1, y: 101, width: 0, height: 0 }) }),
  Object.freeze({
    name: 'marquee',
    rect: Object.freeze({ x: -1, y: 99, width: 2_051, height: 6 }),
  }),
] satisfies readonly Readonly<{ name: string; rect: PageRect }>[]);

type DiagnosticTotals = Readonly<{
  cellIterations: number;
  bucketReferencesRead: number;
  uniqueAabbChecks: number;
  narrowPhaseCalls: number;
  clipOperations: number;
  usedScanFallbackQueries: number;
}>;

type ChildReport = Readonly<{
  nodeCount: number;
  fixtureBuildMs: number;
  indexBuildMs: number;
  firstIndexedQueryMs: number;
  indexedTimedQueryCount: number;
  indexedWarmMedianMs: number;
  indexedWarmP95Ms: number;
  directTimedQueryCount: number;
  directWarmMedianMs: number;
  directWarmP95Ms: number;
  oracleQueryCount: number;
  exactResultsMatched: boolean;
  diagnosticTotals: DiagnosticTotals;
  rssBeforeFixtureBytes: number;
  rssAfterFixtureBytes: number;
  rssAfterIndexBytes: number;
  indexRssDeltaBytes: number;
}>;

function nodeId(index: number): NodeId {
  return `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}` as NodeId;
}

function forceGarbageCollection(): void {
  Bun.gc(true);
}

function buildValidatedFixture(): BringsDocument {
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
    width: 4,
    height: 4,
    cornerRadii: [0, 0, 0, 0],
    fill: paint,
    stroke: null,
  }));
  const result = validateDocument({
    id: documentId,
    revision: 0,
    name: '100k page-hit benchmark fixture',
    pageOrder: [pageId],
    activePageId: pageId,
    pages: [{ id: pageId, name: 'Page', rootNodeIds }],
    nodes,
  });
  if (!result.ok) throw new Error(`Fixture validation failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function durationMs(operation: () => void): number {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error('Cannot summarize an empty timing sample.');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot summarize an empty value sample.');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function sameResult(left: Result<readonly NodeId[]>, right: Result<readonly NodeId[]>): boolean {
  if (left.ok !== right.ok) return false;
  if (!left.ok && !right.ok) {
    return left.error.code === right.error.code && left.error.path === right.error.path;
  }
  if (!left.ok || !right.ok || left.value.length !== right.value.length) return false;
  return left.value.every((id, index) => id === right.value[index]);
}

function addMetrics(target: MutableDiagnosticTotals, metrics: PageHitQueryMetrics): void {
  target.cellIterations += metrics.cellIterations;
  target.bucketReferencesRead += metrics.bucketReferencesRead;
  target.uniqueAabbChecks += metrics.uniqueAabbChecks;
  target.narrowPhaseCalls += metrics.narrowPhaseCalls;
  target.clipOperations += metrics.clipOperations;
  if (metrics.usedScanFallback) target.usedScanFallbackQueries += 1;
}

type MutableDiagnosticTotals = {
  -readonly [Key in keyof DiagnosticTotals]: DiagnosticTotals[Key];
};

function runChild(): ChildReport {
  forceGarbageCollection();
  const rssBeforeFixtureBytes = process.memoryUsage().rss;

  let document: BringsDocument | undefined;
  const fixtureBuildMs = durationMs(() => {
    document = buildValidatedFixture();
  });
  if (document === undefined) throw new Error('Fixture construction did not return a document.');
  const fixtureDocument = document;

  forceGarbageCollection();
  const rssAfterFixtureBytes = process.memoryUsage().rss;

  let created: ReturnType<typeof createPageHitIndex> | undefined;
  const indexBuildMs = durationMs(() => {
    created = createPageHitIndex(fixtureDocument);
  });
  if (created === undefined || !created.ok) {
    throw new Error(`Index construction failed: ${JSON.stringify(created?.error)}`);
  }
  const index = created.value;

  forceGarbageCollection();
  const rssAfterIndexBytes = process.memoryUsage().rss;
  const indexRssDeltaBytes = rssAfterIndexBytes - rssAfterFixtureBytes;

  let firstResult: Result<readonly NodeId[]> | undefined;
  const firstIndexedQueryMs = durationMs(() => {
    firstResult = index.intersect(QUERY_KINDS[0]!.rect);
  });

  for (let queryIndex = 0; queryIndex < INDEX_WARMUP_QUERIES; queryIndex += 1) {
    index.intersect(QUERY_KINDS[queryIndex % QUERY_KINDS.length]!.rect);
  }

  const oracleResults = QUERY_KINDS.map(({ rect }) => intersectPageRect(fixtureDocument, rect));
  let exactResultsMatched = firstResult !== undefined && sameResult(firstResult, oracleResults[0]!);
  for (let queryIndex = 0; queryIndex < QUERY_KINDS.length; queryIndex += 1) {
    exactResultsMatched &&= sameResult(
      index.intersect(QUERY_KINDS[queryIndex]!.rect),
      oracleResults[queryIndex]!,
    );
  }

  for (let queryIndex = 0; queryIndex < QUERY_KINDS.length * 3; queryIndex += 1) {
    intersectPageRect(fixtureDocument, QUERY_KINDS[queryIndex % QUERY_KINDS.length]!.rect);
  }

  const directTimings: number[] = [];
  for (let queryIndex = 0; queryIndex < DIRECT_TIMED_QUERIES; queryIndex += 1) {
    const kindIndex = queryIndex % QUERY_KINDS.length;
    let directResult: Result<readonly NodeId[]> | undefined;
    directTimings.push(
      durationMs(() => {
        directResult = intersectPageRect(fixtureDocument, QUERY_KINDS[kindIndex]!.rect);
      }),
    );
    if (directResult === undefined || !sameResult(directResult, oracleResults[kindIndex]!)) {
      exactResultsMatched = false;
    }
  }

  const diagnosticTotals: MutableDiagnosticTotals = {
    cellIterations: 0,
    bucketReferencesRead: 0,
    uniqueAabbChecks: 0,
    narrowPhaseCalls: 0,
    clipOperations: 0,
    usedScanFallbackQueries: 0,
  };
  const indexedTimings: number[] = [];
  for (let queryIndex = 0; queryIndex < INDEX_TIMED_QUERIES; queryIndex += 1) {
    const kindIndex = queryIndex % QUERY_KINDS.length;
    let inspected: ReturnType<typeof inspectPageHitIndex> | undefined;
    indexedTimings.push(
      durationMs(() => {
        inspected = inspectPageHitIndex(index, QUERY_KINDS[kindIndex]!.rect);
      }),
    );
    if (inspected === undefined) throw new Error('Indexed query did not return diagnostics.');
    addMetrics(diagnosticTotals, inspected.metrics);
    if (!sameResult(inspected.result, oracleResults[kindIndex]!)) exactResultsMatched = false;
  }

  return Object.freeze({
    nodeCount: NODE_COUNT,
    fixtureBuildMs,
    indexBuildMs,
    firstIndexedQueryMs,
    indexedTimedQueryCount: indexedTimings.length,
    indexedWarmMedianMs: median(indexedTimings),
    indexedWarmP95Ms: percentile(indexedTimings, 0.95),
    directTimedQueryCount: directTimings.length,
    directWarmMedianMs: median(directTimings),
    directWarmP95Ms: percentile(directTimings, 0.95),
    oracleQueryCount: QUERY_KINDS.length,
    exactResultsMatched,
    diagnosticTotals: Object.freeze({ ...diagnosticTotals }),
    rssBeforeFixtureBytes,
    rssAfterFixtureBytes,
    rssAfterIndexBytes,
    indexRssDeltaBytes,
  });
}

async function runParent(): Promise<void> {
  const runs: ChildReport[] = [];
  for (let runIndex = 0; runIndex < PROCESS_RUNS; runIndex += 1) {
    const subprocess = Bun.spawn([process.execPath, import.meta.path, '--child'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Benchmark child ${runIndex + 1} failed (${exitCode}): ${stderr.trim()}`);
    }
    runs.push(JSON.parse(stdout) as ChildReport);
  }

  const indexedWarmMedianMs = median(runs.map((run) => run.indexedWarmMedianMs));
  const directWarmMedianMs = median(runs.map((run) => run.directWarmMedianMs));
  const medianIndexRssDeltaBytes = median(runs.map((run) => run.indexRssDeltaBytes));
  const speedup = directWarmMedianMs / indexedWarmMedianMs;
  const summary = Object.freeze({
    fixture: Object.freeze({
      nodeCount: NODE_COUNT,
      processRuns: PROCESS_RUNS,
      indexWarmupQueriesPerRun: INDEX_WARMUP_QUERIES,
      indexedTimedQueriesPerRun: INDEX_TIMED_QUERIES,
      directTimedQueriesPerRun: DIRECT_TIMED_QUERIES,
      oracleQueryKindsPerRun: QUERY_KINDS.length,
      directTimingMethod:
        'Balanced 30-query sample after nine direct warmups; all three unique query kinds are compared exactly against every indexed result.',
    }),
    aggregate: Object.freeze({
      indexedWarmMedianMs,
      indexedWarmP95Ms: median(runs.map((run) => run.indexedWarmP95Ms)),
      directWarmMedianMs,
      directWarmP95Ms: median(runs.map((run) => run.directWarmP95Ms)),
      speedup,
      medianIndexRssDeltaBytes,
      maximumIndexRssDeltaBytes: Math.max(...runs.map((run) => run.indexRssDeltaBytes)),
      exactResultsMatched: runs.every((run) => run.exactResultsMatched),
    }),
    thresholds: Object.freeze({
      minimumSpeedup: MINIMUM_SPEEDUP,
      maximumMedianIndexRssDeltaBytes: MAX_INDEX_RSS_DELTA_BYTES,
    }),
    runs,
  });

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.aggregate.exactResultsMatched) {
    throw new Error('Indexed benchmark results differ from the direct traversal oracle.');
  }
  if (speedup < MINIMUM_SPEEDUP) {
    throw new Error(
      `Indexed warm median is only ${speedup.toFixed(2)}x faster; expected at least ${MINIMUM_SPEEDUP}x.`,
    );
  }
  if (medianIndexRssDeltaBytes > MAX_INDEX_RSS_DELTA_BYTES) {
    throw new Error(
      `Median index RSS delta is ${medianIndexRssDeltaBytes} bytes; expected at most ${MAX_INDEX_RSS_DELTA_BYTES}.`,
    );
  }
}

if (process.argv.includes('--child')) {
  console.log(JSON.stringify(runChild()));
} else {
  await runParent();
}

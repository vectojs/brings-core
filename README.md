# Brings Core

`@vectojs/brings-core` is the renderer-independent document foundation for
Brings, a local-first vector editor built with VectoJS.

It owns durable document data, geometry, selection normalization, commands,
history, validation, and canonical JSON interchange. It deliberately does not
import VectoJS, DOM APIs, browser storage, Canvas, or pointer events. The
Website is responsible for the VectoJS scene, browser persistence, and input
sessions.

## Current Core surface

The current Core provides strict schema-v1 document validation and a
transactional in-memory store. It supports Frame, Group, Rectangle, Ellipse,
and Text document values; page creation, renaming, reordering, deletion, and
activation; intention-level Frame and Rectangle creation; detached-subtree
insertion and atomic multi-subtree deletion; normalized ephemeral selection;
renderer-free point and rectangle intersection; reusable immutable page-hit
indexes; page-space affine transform deltas; and atomic undo/redo with monotonic
revisions. It also prepares detached selection resize plans with recursive model
bounds, eight handles, modifier-aware affine proposals, and exact transform
commands without importing a renderer or pointer-event type.

The Core accepts caller-provided lowercase RFC-4122 UUIDs and has no random-ID
policy. Fallible document, selection, index-construction, and rectangle-query
boundaries return `Result<T>` with a stable machine error code and JSON Pointer
path. `hitTestPage` and `PageHitIndex.hitTest` instead preserve a non-throwing
point-query contract and return an empty array on invalid input or geometry
failure. Affine validation and inversion report `matrix.computation-overflow`
at the caller-provided path when a finite matrix produces a non-finite
determinant or inverse. Validated document values and store snapshots are
detached from caller-owned input and expose readonly public types.

```ts
import {
  createDocumentStore,
  createPageHitIndex,
  intersectPageRect,
  resolveStructuralSelection,
  type Result,
} from '@vectojs/brings-core';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code} at ${result.error.path}`);
  return result.value;
}

const pageId = '22222222-2222-4222-8222-222222222222';
const rectangleId = '33333333-3333-4333-8333-333333333333';
const store = unwrap(
  createDocumentStore({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Untitled',
    initialPage: { id: pageId, name: 'Page 1' },
  }),
);

unwrap(
  store.execute({
    kind: 'create-rectangle',
    pageId,
    parentId: null,
    index: 0,
    rectangle: {
      id: rectangleId,
      name: 'Rectangle',
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 40, 30],
      width: 160,
      height: 100,
      cornerRadii: [0, 0, 0, 0],
      fill: { type: 'solid', r: 0.15, g: 0.45, b: 1, a: 1 },
      stroke: null,
    },
  }),
);

const snapshot = store.snapshot();
const marquee = { x: 20, y: 20, width: 220, height: 140 } as const;

// Use the one-shot helper for an occasional query.
const oneShotIds = unwrap(intersectPageRect(snapshot.document, marquee));

// Reuse one immutable index for repeated queries against the same snapshot.
const index = unwrap(createPageHitIndex(snapshot.document));
const indexedIds = unwrap(index.intersect(marquee));

if (oneShotIds.join() !== indexedIds.join()) {
  throw new Error('One-shot and indexed queries must preserve the same order.');
}

const selection = unwrap(
  resolveStructuralSelection(snapshot.document, {
    nodeIds: indexedIds,
    activeNodeId: indexedIds.at(-1) ?? null,
  }),
);
const selectedSnapshot = unwrap(store.setSelection(selection));

console.log(selectedSnapshot.selection.nodeIds); // [rectangleId]
```

`intersectPageRect` returns eligible node IDs in stable back-to-front order;
`hitTestPage` and `PageHitIndex.hitTest` return front-to-back point hits. Both
paths use exact affine polygon/ellipse silhouettes, centered strokes, and
unexpanded ancestor Frame clipping. Frame, Rectangle, Ellipse, and Text remain
selectable even when their background or fill is transparent; Group contributes
hierarchy and transforms but has no selection silhouette.

Create a `PageHitIndex` once for a detached immutable document snapshot when an
interaction will issue repeated point or marquee queries. Rebuild the index after
a durable document revision changes. The one-shot helpers intentionally do not
cache by document identity, so they remain safe even when external JavaScript
mutates a value that TypeScript declared readonly.

Every fallible rectangle query reports stable geometry error codes and JSON
Pointer paths. `PageHitIndex.hitTest` and the compatible one-shot `hitTestPage`
preserve their non-throwing point-query contract by returning an empty array when
the point is invalid or exact geometry evaluation fails.

The store remains responsible for committing normalized ephemeral selection and
durable commands. For example, one gesture can apply a page-space delta to the
selection committed above:

```ts
unwrap(
  store.execute({
    kind: 'apply-transform-delta',
    nodeIds: store.snapshot().selection.nodeIds,
    delta: [1, 0, 0, 1, 24, -8],
  }),
);
```

Core owns document and hierarchy math; a Website gesture previews transiently
and commits only its final selection or delta. The Core remains independent from
DOM, PointerEvent, Canvas, and VectoJS runtime types.

## Prepared resize plans

Prepare resize geometry once when a gesture begins, then ask the immutable plan
for pure proposals as the pointer moves. Core normalizes the selection, resolves
recursive Group bounds without stroke expansion, and keeps the pointer offset,
anchor, modifier, signed-scale, and command math in one renderer-free contract.

```ts
import { prepareSelectionResize } from '@vectojs/brings-core';

const resize = unwrap(
  prepareSelectionResize(store.snapshot().document, store.snapshot().selection),
);
const east = resize.handles.find((entry) => entry.handle === 'east')!;
const proposal = unwrap(
  resize.propose({
    handle: east.handle,
    startPoint: east.point,
    currentPoint: { x: east.point.x + 32, y: east.point.y },
    preserveAspectRatio: false,
    fromCenter: false,
  }),
);

// Preview `proposal.bounds` without mutating the document. Pointerup commits
// the exact frozen command so preview and history cannot disagree.
unwrap(store.execute(proposal.command));
```

All eight axis-aligned handles use the opposite handle as their default anchor.
Set `fromCenter` for center-anchored scaling and `preserveAspectRatio` for uniform
scaling; callers normally map Alt and Shift to those semantic modifiers. Crossing
the anchor produces a signed scale. Singular and computed-overflow proposals are
rejected without changing the prepared plan or caller-owned input.

The package does not yet include property commands, grouping/reparenting, resize
snapping, rotation editing, codec parsing or serialization, persistence, or
browser adapters. Those remain independently verified slices.

## Minimal document creation

For callers that only need an empty document store:

```ts
const storeResult = createDocumentStore({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Untitled',
  initialPage: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Page 1',
  },
});

if (storeResult.ok) {
  const store = storeResult.value;
  const snapshot = store.snapshot();
  console.log(snapshot.document.revision); // 0
}
```

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

## License

MIT. See [LICENSE](./LICENSE).

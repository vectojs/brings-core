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
insertion and atomic multi-subtree deletion; normalized ephemeral selection; renderer-free
page-space hit testing; page-space affine transform deltas; and atomic
undo/redo with monotonic revisions.

The Core accepts caller-provided lowercase RFC-4122 UUIDs and has no random-ID
policy. Every public operation returns `Result<T>` with a stable machine error
code and JSON Pointer path. Returned values are detached snapshots.

```ts
import { createDocumentStore } from '@vectojs/brings-core';

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

  // After creating/selecting nodes, one gesture commits one page-space delta.
  const selectedNodeIds = store.snapshot().selection.nodeIds;
  if (selectedNodeIds.length > 0) {
    store.execute({
      kind: 'apply-transform-delta',
      nodeIds: selectedNodeIds,
      delta: [1, 0, 0, 1, 24, -8],
    });
  }

  const selection = store.snapshot().selection.nodeIds;
  if (selection.length > 0) {
    store.execute({ kind: 'delete-nodes', nodeIds: selection });
  }
}
```

Core owns document and hierarchy math; a Website gesture previews transiently
and commits only its final delta. The Core remains independent from DOM,
PointerEvent, Canvas, and VectoJS runtime types.

The package does not yet include marquee/bounds queries, property commands,
grouping/reparenting, codec parsing or serialization, persistence, or browser
adapters. Those remain independently verified slices.

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

## License

MIT. See [LICENSE](./LICENSE).

# Brings Core

`@vectojs/brings-core` is the renderer-independent document foundation for
Brings, a local-first vector editor built with VectoJS.

It owns durable document data, geometry, selection normalization, commands,
history, validation, and canonical JSON interchange. It deliberately does not
import VectoJS, DOM APIs, browser storage, Canvas, or pointer events. The
Website is responsible for the VectoJS scene, browser persistence, and input
sessions.

## Document tracer

The first public tracer provides strict schema-v1 document validation and a
transactional in-memory store. It supports Frame, Group, Rectangle, Ellipse,
and Text document values; page creation, renaming, reordering, deletion, and
activation; inserting or deleting a detached node subtree; and atomic undo/redo
with monotonic revisions.

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
  const snapshot = storeResult.value.snapshot();
  console.log(snapshot.document.revision); // 0
}
```

This tracer deliberately does not include geometry bounds, hit testing, public
selection editing, transforms or property commands, grouping/reparenting,
codec parsing or serialization, persistence, browser APIs, VectoJS APIs, or
publishing automation. Those belong to later independently verified slices.

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

## License

MIT. See [LICENSE](./LICENSE).

# Brings Core

`@vectojs/brings-core` is the renderer-independent document foundation for
Brings, a local-first vector editor built with VectoJS.

It owns durable document data, geometry, selection normalization, commands,
history, validation, and canonical JSON interchange. It deliberately does not
import VectoJS, DOM APIs, browser storage, Canvas, or pointer events. The
Website is responsible for the VectoJS scene, browser persistence, and input
sessions.

## Status

The package bootstrap establishes schema-v1 vocabulary and a DOM-free build
boundary. It is not published until the first useful document tracer bullet is
implemented and verified.

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

## License

MIT. See [LICENSE](./LICENSE).

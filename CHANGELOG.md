# Changelog

## Unreleased

### Minor Changes

- Add validated Path networks with stable vertices and cubic segments, atomic
  `create-path` and `set-path-network` commands, exact transformed curve bounds,
  adaptive fill and stroke hit testing, resize and alignment integration, and
  public renderer-independent Path traversal and geometry helpers.

## 0.14.0

### Minor Changes

- c4ac386: Add a public `create-ellipse` document command with detached input ownership, schema validation, and atomic undo/redo history.

## 0.13.0

### Minor Changes

- 0ce46c2: Add `openDocumentStore` for validated existing documents with detached
  ownership, revision continuation, and fresh ephemeral selection/history state.

## 0.12.0

### Minor Changes

- 5c62516: Add the public `create-text` document command for validated, undoable Text node creation.

## 0.11.0

### Minor Changes

- bb68c79: Add atomic property, layer movement, grouping, ungrouping, and selection reconciliation commands for renderer-free editor consumers.

## 0.10.1

### Patch Changes

- 035eda7: Recompute move alignment guide extents from the final snapped selection bounds.

## 0.10.0

### Minor Changes

- ae2c97e: Add immutable prepared selection alignment snapping for deterministic move and axis-aligned resize previews, including exact pointer replay and guide diagnostics.

## 0.9.1

### Patch Changes

- b1840b1: Reject affine matrices when determinant or inverse computation overflows instead of accepting corrupt transforms.

## 0.9.0

### Minor Changes

- 0d79a10: Add immutable prepared selection resize plans with recursive model bounds, eight handles, modifier-aware signed scaling, projected previews, and exact affine transform commands.

## 0.8.0

### Minor Changes

- a1f9778: Add exact clipped page-rectangle intersection queries, reusable immutable page-hit
  indexes, transparent selection silhouettes, and a pure structural-selection
  normalizer for marquee and additive editor gestures.

## 0.7.0

### Minor Changes

- 06fa914: Add atomic multi-selection deletion with active-page validation, lock protection,
  empty-Group pruning, and selection-restoring undo/redo history.

## 0.6.0

### Minor Changes

- 0cf35f9: Add atomic page-space transform-delta commands with parent-local affine derivation and selection-preserving history.

## 0.5.0

### Minor Changes

- b84120e: Add renderer-free page-space Frame and Rectangle hit testing for Core-owned selection.

## 0.4.0

### Minor Changes

- 44c18cc: Add normalized ephemeral selection state with detached snapshots and history restoration.

## 0.3.0

### Minor Changes

- 0432f80: Add validated, undoable Frame and Rectangle creation commands for the first Brings editor interactions.

## 0.2.1

### Patch Changes

- 8568a0c: Correct the published ESM and CommonJS entry points and verify them after every build.

## 0.2.0

### Minor Changes

- a95734e: Add the DOM-free schema-v1 document tracer with strict graph validation, page
  and detached-subtree commands, and atomic monotonic undo/redo history.

All notable changes to this project will be documented in this file.

## Historical unreleased notes

- Reject finite affine matrices whose determinant or inverse computation
  overflows, using the stable `matrix.computation-overflow` error boundary.
- Added `prepareSelectionResize` for detached unstroked model bounds, recursive
  Group geometry, eight handle centers, opposite/center anchors, constrained and
  signed affine scale proposals, projected preview bounds, and exact frozen
  `apply-transform-delta` commands.
- Added stable selection, singular-matrix, invalid-point, and computed-overflow
  failures for renderer-free resize preparation and proposal generation.
- Added `PageRect`, `intersectPageRect`, `PageHitIndex`, and
  `createPageHitIndex` for exact renderer-free rectangle queries in stable
  back-to-front document order. The reusable immutable index preserves the
  one-shot result and error contract while accelerating repeated point and
  marquee queries against one document snapshot.
- Added exact affine polygon and ellipse selection silhouettes, inclusive edge
  contact, centered local strokes, and nested unexpanded Frame clipping.
- Added stable `geometry.*` errors and JSON Pointer paths for invalid rectangles,
  computed overflow, missing active pages, and document topology violations;
  clipped-away subtree errors remain unreachable until their clip chain is
  active for a query.
- Added the pure `resolveStructuralSelection` boundary for duplicate removal,
  active-page eligibility, selected-ancestor normalization, and active-node
  fallback before an editor commits selection through the store.
- Expanded `hitTestPage` compatibly to use the shared exact silhouettes and to
  return eligible transparent Frame, Rectangle, Ellipse, and Text nodes. Its
  front-to-back ordering and non-throwing empty-array failure contract are
  unchanged.
- Added atomic page-space transform-delta commands with parent-local matrix
  derivation and selection-preserving undo/redo history.
- Added strict schema-v1 document validation, canonical graph ordering, and
  detached snapshots.
- Added transactional page/subtree command planning and an in-memory undo/redo
  store with monotonic revisions.
- Established the public, DOM-free package boundary for Brings Core.

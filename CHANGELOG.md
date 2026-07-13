# Changelog

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

## Unreleased

- Added atomic page-space transform-delta commands with parent-local matrix
  derivation and selection-preserving undo/redo history.
- Added strict schema-v1 document validation, canonical graph ordering, and
  detached snapshots.
- Added transactional page/subtree command planning and an in-memory undo/redo
  store with monotonic revisions.
- Established the public, DOM-free package boundary for Brings Core.

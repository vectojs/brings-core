# Changelog

## 0.2.1

### Patch Changes

- 8568a0c: Correct the published ESM and CommonJS entry points and verify them after every build.

## 0.2.0

### Minor Changes

- a95734e: Add the DOM-free schema-v1 document tracer with strict graph validation, page
  and detached-subtree commands, and atomic monotonic undo/redo history.

All notable changes to this project will be documented in this file.

## Unreleased

- Added strict schema-v1 document validation, canonical graph ordering, and
  detached snapshots.
- Added transactional page/subtree command planning and an in-memory undo/redo
  store with monotonic revisions.
- Established the public, DOM-free package boundary for Brings Core.

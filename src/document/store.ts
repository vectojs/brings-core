import {
  cloneContent,
  cloneDocument,
  cloneDocumentContent,
  cloneStructuralSelection,
  emptyStructuralSelection,
} from './clone';
import { planCommand } from './plan';
import { nextDocumentRevision } from './revision';
import { createDocument, isLowercaseRfc4122Uuid } from './validate';
import type {
  BringsDocument,
  CreateDocumentInput,
  DocumentCommandInput,
  DocumentContent,
  Result,
  SelectionInput,
  NodeId,
  SceneNode,
  StructuralSelection,
} from './types';

type HistoryEntry = Readonly<{
  before: DocumentContent;
  after: DocumentContent;
  beforeSelection: StructuralSelection;
  afterSelection: StructuralSelection;
}>;

/** A detached public view of current document, selection, and history depths. */
export type EditorSnapshot = Readonly<{
  document: BringsDocument;
  selection: StructuralSelection;
  undoDepth: number;
  redoDepth: number;
}>;

/** Atomic document command/history owner with no browser or renderer dependency. */
export interface BringsDocumentStore {
  snapshot(): EditorSnapshot;
  setSelection(input: SelectionInput): Result<EditorSnapshot>;
  execute(command: DocumentCommandInput): Result<EditorSnapshot>;
  undo(): Result<EditorSnapshot>;
  redo(): Result<EditorSnapshot>;
}

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function nodeMap(document: BringsDocument): Map<string, SceneNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

function belongsToActivePage(
  document: BringsDocument,
  nodes: ReadonlyMap<string, SceneNode>,
  node: SceneNode,
): boolean {
  let root = node;
  while (root.parentId !== null) {
    const parent = nodes.get(root.parentId);
    if (parent === undefined) return false;
    root = parent;
  }
  return (
    document.pages
      .find((page) => page.id === document.activePageId)
      ?.rootNodeIds.includes(root.id) ?? false
  );
}

function isSelectionEligible(nodes: ReadonlyMap<string, SceneNode>, node: SceneNode): boolean {
  let current: SceneNode | undefined = node;
  while (current !== undefined) {
    if (!current.visible || current.locked) return false;
    current = current.parentId === null ? undefined : nodes.get(current.parentId);
  }
  return true;
}

function hasSelectedAncestor(
  nodes: ReadonlyMap<string, SceneNode>,
  node: SceneNode,
  selected: ReadonlySet<string>,
): boolean {
  let parentId = node.parentId;
  while (parentId !== null) {
    if (selected.has(parentId)) return true;
    parentId = nodes.get(parentId)?.parentId ?? null;
  }
  return false;
}

function normalizeSelection(
  document: BringsDocument,
  input: SelectionInput,
): Result<StructuralSelection> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('selection.invalid', '/');
  }
  if (!Array.isArray(input.nodeIds)) return failure('selection.node-ids', '/nodeIds');
  if (input.activeNodeId !== null && typeof input.activeNodeId !== 'string') {
    return failure('selection.active-node', '/activeNodeId');
  }
  const nodes = nodeMap(document);
  const unique: SceneNode[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.nodeIds.length; index += 1) {
    const id = input.nodeIds[index];
    if (typeof id !== 'string' || !isLowercaseRfc4122Uuid(id)) {
      return failure('id.invalid', `/nodeIds/${index}`);
    }
    if (seen.has(id)) continue;
    const node = nodes.get(id);
    if (node === undefined) return failure('node.not-found', `/nodeIds/${index}`);
    if (!belongsToActivePage(document, nodes, node)) {
      return failure('selection.page-mismatch', `/nodeIds/${index}`);
    }
    if (!isSelectionEligible(nodes, node)) {
      return failure('selection.ineligible', `/nodeIds/${index}`);
    }
    seen.add(id);
    unique.push(node);
  }
  const normalized = unique.filter((node) => !hasSelectedAncestor(nodes, node, seen));
  const nodeIds = normalized.map((node) => node.id);
  const requestedActive = input.activeNodeId;
  if (requestedActive !== null && !isLowercaseRfc4122Uuid(requestedActive)) {
    return failure('id.invalid', '/activeNodeId');
  }
  const activeNodeId = nodeIds.includes(requestedActive as NodeId)
    ? (requestedActive as NodeId)
    : (nodeIds.at(-1) ?? null);
  return success({ nodeIds, activeNodeId });
}

function createHistoryEntry(
  before: BringsDocument,
  after: DocumentContent,
  beforeSelection: StructuralSelection,
): HistoryEntry {
  return {
    before: cloneDocumentContent(before),
    after: cloneContent(after),
    beforeSelection: cloneStructuralSelection(beforeSelection),
    afterSelection: emptyStructuralSelection(),
  };
}

class InMemoryBringsDocumentStore implements BringsDocumentStore {
  private document: BringsDocument;
  private selection: StructuralSelection = emptyStructuralSelection();
  private readonly undoEntries: HistoryEntry[] = [];
  private readonly redoEntries: HistoryEntry[] = [];

  constructor(document: BringsDocument) {
    this.document = cloneDocument(document);
  }

  snapshot(): EditorSnapshot {
    return {
      document: cloneDocument(this.document),
      selection: cloneStructuralSelection(this.selection),
      undoDepth: this.undoEntries.length,
      redoDepth: this.redoEntries.length,
    };
  }

  setSelection(input: SelectionInput): Result<EditorSnapshot> {
    const selection = normalizeSelection(this.document, input);
    if (!selection.ok) return selection;
    this.selection = cloneStructuralSelection(selection.value);
    return success(this.snapshot());
  }

  execute(command: DocumentCommandInput): Result<EditorSnapshot> {
    const planned = planCommand(this.document, command);
    if (!planned.ok) return planned;
    const next = nextDocumentRevision(this.document, planned.value);
    if (!next.ok) return next;

    if (command.kind === 'activate-page') {
      this.document = next.value;
      this.selection = emptyStructuralSelection();
      return success(this.snapshot());
    }

    const entry = createHistoryEntry(this.document, planned.value, this.selection);
    this.document = next.value;
    this.selection = emptyStructuralSelection();
    this.undoEntries.push(entry);
    this.redoEntries.length = 0;
    return success(this.snapshot());
  }

  undo(): Result<EditorSnapshot> {
    const entry = this.undoEntries[this.undoEntries.length - 1];
    if (entry === undefined) return failure('history.undo-empty', '/history/undo');
    const next = nextDocumentRevision(this.document, entry.before);
    if (!next.ok) return next;
    this.undoEntries.pop();
    this.redoEntries.push(entry);
    this.document = next.value;
    this.selection = cloneStructuralSelection(entry.beforeSelection);
    return success(this.snapshot());
  }

  redo(): Result<EditorSnapshot> {
    const entry = this.redoEntries[this.redoEntries.length - 1];
    if (entry === undefined) return failure('history.redo-empty', '/history/redo');
    const next = nextDocumentRevision(this.document, entry.after);
    if (!next.ok) return next;
    this.redoEntries.pop();
    this.undoEntries.push(entry);
    this.document = next.value;
    this.selection = cloneStructuralSelection(entry.afterSelection);
    return success(this.snapshot());
  }
}

/** Create a revision-zero document and its atomic history owner. */
export function createDocumentStore(input: CreateDocumentInput): Result<BringsDocumentStore> {
  const document = createDocument(input);
  if (!document.ok) return document;
  return success(new InMemoryBringsDocumentStore(document.value));
}

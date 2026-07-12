import {
  cloneContent,
  cloneDocument,
  cloneDocumentContent,
  cloneStructuralSelection,
  emptyStructuralSelection,
} from './clone';
import { planCommand } from './plan';
import { nextDocumentRevision } from './revision';
import { createDocument } from './validate';
import type {
  BringsDocument,
  CreateDocumentInput,
  DocumentCommandInput,
  DocumentContent,
  Result,
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

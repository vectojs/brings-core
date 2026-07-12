import { validateDocument } from './validate';
import type { BringsDocument, DocumentContent, Result } from './types';

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

/**
 * Rebuild validated durable content under the current document identity with a
 * monotonically increasing revision.
 */
export function nextDocumentRevision(
  current: BringsDocument,
  content: DocumentContent,
): Result<BringsDocument> {
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    return failure('revision.overflow', '/revision');
  }
  return validateDocument({
    id: current.id,
    revision: current.revision + 1,
    name: content.name,
    pageOrder: content.pageOrder,
    activePageId: content.activePageId,
    pages: content.pages,
    nodes: content.nodes,
  });
}

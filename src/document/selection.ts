import { isLowercaseRfc4122Uuid } from './validate';
import type {
  BringsDocument,
  NodeId,
  Result,
  SceneNode,
  SelectionInput,
  StructuralSelection,
} from './types';

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

/** Validate and normalize an ephemeral selection without retaining caller-owned state. */
export function resolveStructuralSelection(
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

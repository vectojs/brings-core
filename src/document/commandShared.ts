import { cloneContent, cloneNode } from './clone';
import { isLowercaseRfc4122Uuid, validateDocument } from './validate';
import type {
  BringsDocument,
  DocumentContent,
  FrameNode,
  GroupNode,
  NodeId,
  Page,
  PageId,
  Result,
  SceneNode,
  UUID,
} from './types';

export type NodeEntry = Readonly<{ index: number; node: SceneNode }>;

export function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function commandId(value: string, path: string): Result<UUID> {
  if (!isLowercaseRfc4122Uuid(value)) return failure('id.invalid', path);
  return success(value);
}

export function commandIndex(value: number, maximum: number, path = '/index'): Result<number> {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    return failure('command.index', path);
  }
  return success(value);
}

export function nodeMap(content: DocumentContent): Map<string, NodeEntry> {
  return new Map(content.nodes.map((node, index) => [node.id, { index, node }]));
}

export function childIdsOf(node: SceneNode): readonly NodeId[] {
  return node.type === 'frame' || node.type === 'group' ? node.childIds : [];
}

export function isContainer(node: SceneNode): node is FrameNode | GroupNode {
  return node.type === 'frame' || node.type === 'group';
}

export function withParent(node: SceneNode, parentId: NodeId | null): SceneNode {
  return { ...cloneNode(node), parentId } as SceneNode;
}

export function withChildIds(node: FrameNode | GroupNode, childIds: readonly NodeId[]): SceneNode {
  if (node.type === 'frame') {
    const frame = cloneNode(node) as FrameNode;
    return { ...frame, childIds: [...childIds] };
  }
  const group = cloneNode(node) as GroupNode;
  return { ...group, childIds: [...childIds] as [NodeId, ...NodeId[]] };
}

export function withPagesAndNodes(
  content: DocumentContent,
  pages: readonly Page[],
  nodes: readonly SceneNode[],
  activePageId = content.activePageId,
): DocumentContent {
  return {
    name: content.name,
    pageOrder: pages.map((page) => page.id),
    activePageId,
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      rootNodeIds: [...page.rootNodeIds],
    })),
    nodes: nodes.map(cloneNode),
  };
}

function canonicalize(content: DocumentContent): DocumentContent {
  const byId = new Map(content.nodes.map((node) => [node.id, node]));
  const ordered: SceneNode[] = [];
  const visit = (nodeId: NodeId): void => {
    const node = byId.get(nodeId);
    if (node === undefined) return;
    ordered.push(cloneNode(node));
    for (const childId of childIdsOf(node)) visit(childId);
  };
  for (const page of content.pages) {
    for (const rootId of page.rootNodeIds) visit(rootId);
  }
  return withPagesAndNodes(content, content.pages, ordered);
}

export function commitCandidate(
  before: BringsDocument,
  content: DocumentContent,
): Result<DocumentContent> {
  const validated = validateDocument({
    id: before.id,
    revision: before.revision,
    ...canonicalize(content),
  });
  if (!validated.ok) return validated;
  return success(cloneContent(validated.value));
}

export function pageIndex(content: DocumentContent, pageId: string): number {
  return content.pages.findIndex((page) => page.id === pageId);
}

export function pageForNode(content: DocumentContent, nodeId: NodeId): PageId | null {
  const byId = nodeMap(content);
  let current = byId.get(nodeId)?.node;
  while (current !== undefined && current.parentId !== null) {
    current = byId.get(current.parentId)?.node;
  }
  if (current === undefined) return null;
  return content.pages.find((page) => page.rootNodeIds.includes(current.id))?.id ?? null;
}

export function ancestorIds(content: DocumentContent, nodeId: NodeId): Set<string> {
  const byId = nodeMap(content);
  const ids = new Set<string>();
  let current = byId.get(nodeId)?.node;
  while (current !== undefined) {
    ids.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId)?.node;
  }
  return ids;
}

export function subtreeIds(content: DocumentContent, nodeId: NodeId): Set<string> {
  const byId = nodeMap(content);
  const ids = new Set<string>();
  const visit = (currentId: NodeId): void => {
    if (ids.has(currentId)) return;
    ids.add(currentId);
    const node = byId.get(currentId)?.node;
    if (node === undefined) return;
    for (const childId of childIdsOf(node)) visit(childId);
  };
  visit(nodeId);
  return ids;
}

export function firstLocked(
  content: DocumentContent,
  protectedIds: ReadonlySet<string>,
): Result<void> {
  for (let index = 0; index < content.nodes.length; index += 1) {
    const node = content.nodes[index]!;
    if (protectedIds.has(node.id) && node.locked) {
      return failure('node.locked', `/nodes/${index}/locked`);
    }
  }
  return success(undefined);
}

export function firstHidden(
  content: DocumentContent,
  protectedIds: ReadonlySet<string>,
): Result<void> {
  for (let index = 0; index < content.nodes.length; index += 1) {
    const node = content.nodes[index]!;
    if (protectedIds.has(node.id) && !node.visible) {
      return failure('node.hidden', `/nodes/${index}/visible`);
    }
  }
  return success(undefined);
}

export function replaceContainerChildren(
  nodes: readonly SceneNode[],
  containerId: NodeId,
  childIds: readonly NodeId[],
): SceneNode[] {
  return nodes.map((node) =>
    node.id === containerId && isContainer(node) ? withChildIds(node, childIds) : cloneNode(node),
  );
}

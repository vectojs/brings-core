import { cloneContent, cloneNode } from './clone';
import { isLowercaseRfc4122Uuid, validateDetachedSubtree, validateDocument } from './validate';
import type {
  BringsDocument,
  DocumentCommandInput,
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

type NodeEntry = Readonly<{ index: number; node: SceneNode }>;

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function commandId(value: string, path: string): Result<UUID> {
  if (!isLowercaseRfc4122Uuid(value)) return failure('id.invalid', path);
  return success(value);
}

function commandIndex(value: number, maximum: number): Result<number> {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    return failure('command.index', '/index');
  }
  return success(value);
}

function nodeMap(content: DocumentContent): Map<string, NodeEntry> {
  return new Map(content.nodes.map((node, index) => [node.id, { index, node }]));
}

function childIdsOf(node: SceneNode): readonly NodeId[] {
  return node.type === 'frame' || node.type === 'group' ? node.childIds : [];
}

function isContainer(node: SceneNode): node is FrameNode | GroupNode {
  return node.type === 'frame' || node.type === 'group';
}

function withParent(node: SceneNode, parentId: NodeId | null): SceneNode {
  return { ...cloneNode(node), parentId } as SceneNode;
}

function withChildIds(node: FrameNode | GroupNode, childIds: readonly NodeId[]): SceneNode {
  if (node.type === 'frame') {
    const frame = cloneNode(node) as FrameNode;
    return { ...frame, childIds: [...childIds] };
  }
  const group = cloneNode(node) as GroupNode;
  return { ...group, childIds: [...childIds] as [NodeId, ...NodeId[]] };
}

function withPagesAndNodes(
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

function commitCandidate(
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

function pageIndex(content: DocumentContent, pageId: string): number {
  return content.pages.findIndex((page) => page.id === pageId);
}

function pageForNode(content: DocumentContent, nodeId: NodeId): PageId | null {
  const byId = nodeMap(content);
  let current = byId.get(nodeId)?.node;
  while (current !== undefined && current.parentId !== null)
    current = byId.get(current.parentId)?.node;
  if (current === undefined) return null;
  return content.pages.find((page) => page.rootNodeIds.includes(current!.id))?.id ?? null;
}

function ancestorIds(content: DocumentContent, nodeId: NodeId): Set<string> {
  const byId = nodeMap(content);
  const ids = new Set<string>();
  let current = byId.get(nodeId)?.node;
  while (current !== undefined) {
    ids.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId)?.node;
  }
  return ids;
}

function subtreeIds(content: DocumentContent, nodeId: NodeId): Set<string> {
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

function firstLocked(content: DocumentContent, protectedIds: ReadonlySet<string>): Result<void> {
  for (let index = 0; index < content.nodes.length; index += 1) {
    const node = content.nodes[index]!;
    if (protectedIds.has(node.id) && node.locked) {
      return failure('node.locked', `/nodes/${index}/locked`);
    }
  }
  return success(undefined);
}

function replaceContainerChildren(
  nodes: readonly SceneNode[],
  containerId: NodeId,
  childIds: readonly NodeId[],
): SceneNode[] {
  return nodes.map((node) =>
    node.id === containerId && isContainer(node) ? withChildIds(node, childIds) : cloneNode(node),
  );
}

function insertPage(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'create-page' }>,
): Result<DocumentContent> {
  const id = commandId(command.id, '/id');
  if (!id.ok) return id;
  const index = commandIndex(command.index, before.pages.length);
  if (!index.ok) return index;
  if ([before.id, ...before.pageOrder, ...before.nodes.map((node) => node.id)].includes(id.value)) {
    return failure('id.duplicate', '/id');
  }
  const pages = before.pages.map((page) => ({ ...page, rootNodeIds: [...page.rootNodeIds] }));
  pages.splice(index.value, 0, { id: id.value as PageId, name: command.name, rootNodeIds: [] });
  return commitCandidate(
    before,
    withPagesAndNodes(before, pages, before.nodes, id.value as PageId),
  );
}

function renamePage(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'rename-page' }>,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  const index = pageIndex(before, pageId.value);
  if (index === -1) return failure('page.not-found', '/pageId');
  if (before.pages[index]!.name === command.name) return failure('command.no-change', '/');
  const pages = before.pages.map((page, pageIndexValue) =>
    pageIndexValue === index
      ? { ...page, name: command.name, rootNodeIds: [...page.rootNodeIds] }
      : page,
  );
  return commitCandidate(before, withPagesAndNodes(before, pages, before.nodes));
}

function reorderPage(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'reorder-page' }>,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  const currentIndex = pageIndex(before, pageId.value);
  if (currentIndex === -1) return failure('page.not-found', '/pageId');
  const index = commandIndex(command.index, before.pages.length - 1);
  if (!index.ok) return index;
  if (index.value === currentIndex) return failure('command.no-change', '/');
  const pages = before.pages.map((page) => ({ ...page, rootNodeIds: [...page.rootNodeIds] }));
  const [page] = pages.splice(currentIndex, 1);
  pages.splice(index.value, 0, page!);
  return commitCandidate(before, withPagesAndNodes(before, pages, before.nodes));
}

function deletePage(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'delete-page' }>,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  const index = pageIndex(before, pageId.value);
  if (index === -1) return failure('page.not-found', '/pageId');
  if (before.pages.length === 1) return failure('page.last-required', '/pageOrder');
  const page = before.pages[index]!;
  const deleted = new Set<string>();
  for (const rootId of page.rootNodeIds) {
    for (const nodeId of subtreeIds(before, rootId)) deleted.add(nodeId);
  }
  const locked = firstLocked(before, deleted);
  if (!locked.ok) return locked;
  const pages = before.pages
    .filter((candidate) => candidate.id !== page.id)
    .map((candidate) => ({ ...candidate, rootNodeIds: [...candidate.rootNodeIds] }));
  const activePageId =
    before.activePageId === page.id ? pages[Math.max(0, index - 1)]!.id : before.activePageId;
  const nodes = before.nodes.filter((node) => !deleted.has(node.id)).map(cloneNode);
  return commitCandidate(before, withPagesAndNodes(before, pages, nodes, activePageId));
}

function activatePage(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'activate-page' }>,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  if (pageIndex(before, pageId.value) === -1) return failure('page.not-found', '/pageId');
  if (before.activePageId === pageId.value) return failure('command.no-change', '/');
  return commitCandidate(
    before,
    withPagesAndNodes(before, before.pages, before.nodes, pageId.value as PageId),
  );
}

function insertSubtree(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'insert-subtree' }>,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  const targetPageIndex = pageIndex(before, pageId.value);
  if (targetPageIndex === -1) return failure('page.not-found', '/pageId');
  const rootId = commandId(command.rootId, '/rootId');
  if (!rootId.ok) return rootId;
  const subtree = validateDetachedSubtree(command.nodes, command.rootId);
  if (!subtree.ok) return subtree;
  const existingIds = new Set([
    before.id,
    ...before.pageOrder,
    ...before.nodes.map((node) => node.id),
  ]);
  for (let index = 0; index < subtree.value.length; index += 1) {
    if (existingIds.has(subtree.value[index]!.id))
      return failure('id.duplicate', `/nodes/${index}/id`);
  }
  const byId = nodeMap(before);
  let destinationChildren: readonly NodeId[];
  let protectedIds = new Set<string>();
  if (command.parentId === null) {
    destinationChildren = before.pages[targetPageIndex]!.rootNodeIds;
  } else {
    const parentId = commandId(command.parentId, '/parentId');
    if (!parentId.ok) return parentId;
    const parent = byId.get(parentId.value);
    if (parent === undefined) return failure('node.not-found', '/parentId');
    if (pageForNode(before, parent.node.id) !== pageId.value) {
      return failure('command.destination-page-mismatch', '/parentId');
    }
    if (!isContainer(parent.node)) return failure('node.destination-not-container', '/parentId');
    destinationChildren = parent.node.childIds;
    protectedIds = ancestorIds(before, parent.node.id);
  }
  const index = commandIndex(command.index, destinationChildren.length);
  if (!index.ok) return index;
  const locked = firstLocked(before, protectedIds);
  if (!locked.ok) return locked;
  const insertedRoot = withParent(
    subtree.value[0]!,
    command.parentId === null ? null : (command.parentId as NodeId),
  );
  const insertedNodes = subtree.value.map((node) =>
    node.id === rootId.value ? insertedRoot : cloneNode(node),
  );
  if (command.parentId === null) {
    const pages = before.pages.map((page, pageIndexValue) => {
      if (pageIndexValue !== targetPageIndex)
        return { ...page, rootNodeIds: [...page.rootNodeIds] };
      const rootNodeIds = [...page.rootNodeIds];
      rootNodeIds.splice(index.value, 0, rootId.value as NodeId);
      return { ...page, rootNodeIds };
    });
    return commitCandidate(
      before,
      withPagesAndNodes(before, pages, [...before.nodes, ...insertedNodes]),
    );
  }
  const parentId = command.parentId as NodeId;
  const childIds = [...destinationChildren];
  childIds.splice(index.value, 0, rootId.value as NodeId);
  const nodes = replaceContainerChildren(before.nodes, parentId, childIds);
  nodes.push(...insertedNodes);
  return commitCandidate(before, withPagesAndNodes(before, before.pages, nodes));
}

function deleteNode(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'delete-node' }>,
): Result<DocumentContent> {
  const nodeId = commandId(command.nodeId, '/nodeId');
  if (!nodeId.ok) return nodeId;
  const byId = nodeMap(before);
  const target = byId.get(nodeId.value);
  if (target === undefined) return failure('node.not-found', '/nodeId');
  const deleted = subtreeIds(before, target.node.id);
  const protectedIds = ancestorIds(before, target.node.id);
  for (const id of deleted) protectedIds.add(id);
  const locked = firstLocked(before, protectedIds);
  if (!locked.ok) return locked;

  let ancestor = target.node.parentId === null ? undefined : byId.get(target.node.parentId)?.node;
  while (ancestor?.type === 'group') {
    const remainingChildren = ancestor.childIds.filter((childId) => !deleted.has(childId));
    if (remainingChildren.length !== 0) break;
    deleted.add(ancestor.id);
    ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId)?.node;
  }

  const pages = before.pages.map((page) => ({
    ...page,
    rootNodeIds: page.rootNodeIds.filter((rootId) => !deleted.has(rootId)),
  }));
  const nodes = before.nodes
    .filter((node) => !deleted.has(node.id))
    .map((node) => {
      if (!isContainer(node)) return cloneNode(node);
      return withChildIds(
        node,
        node.childIds.filter((childId) => !deleted.has(childId)),
      );
    });
  return commitCandidate(before, withPagesAndNodes(before, pages, nodes));
}

/** Plan one document command without mutating the supplied document or command. */
export function planCommand(
  before: BringsDocument,
  command: DocumentCommandInput,
): Result<DocumentContent> {
  const detachedBefore = cloneContent(before);
  const document = {
    id: before.id,
    revision: before.revision,
    ...detachedBefore,
  } as BringsDocument;
  switch (command.kind) {
    case 'create-page':
      return insertPage(document, command);
    case 'rename-page':
      return renamePage(document, command);
    case 'reorder-page':
      return reorderPage(document, command);
    case 'delete-page':
      return deletePage(document, command);
    case 'activate-page':
      return activatePage(document, command);
    case 'insert-subtree':
      return insertSubtree(document, command);
    case 'delete-node':
      return deleteNode(document, command);
  }
}

import { cloneNode } from './clone';
import { invertMatrix, multiplyMatrices, pageMatrixForNode } from '../geometry/matrix';
import { validateDetachedSubtree, validateMatrixInput } from './validate';
import {
  ancestorIds,
  commandId,
  commandIndex,
  commitCandidate,
  failure,
  firstLocked,
  isContainer,
  nodeMap,
  pageForNode,
  pageIndex,
  replaceContainerChildren,
  subtreeIds,
  success,
  withChildIds,
  withPagesAndNodes,
  withParent,
} from './commandShared';
import type {
  BringsDocument,
  DocumentCommandInput,
  DocumentContent,
  Matrix,
  NodeId,
  PageId,
  Result,
  SceneNode,
} from './types';

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

function createFrame(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'create-frame' }>,
): Result<DocumentContent> {
  const frame = {
    ...command.frame,
    type: 'frame' as const,
    parentId: null,
    childIds: [],
    transform: [...command.frame.transform],
    cornerRadii: [...command.frame.cornerRadii],
    background: command.frame.background === null ? null : { ...command.frame.background },
    stroke:
      command.frame.stroke === null
        ? null
        : { paint: { ...command.frame.stroke.paint }, width: command.frame.stroke.width },
  };
  return insertSubtree(before, {
    kind: 'insert-subtree',
    pageId: command.pageId,
    parentId: command.parentId,
    index: command.index,
    rootId: command.frame.id,
    nodes: [frame],
  });
}

function createRectangle(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'create-rectangle' }>,
): Result<DocumentContent> {
  const rectangle = {
    ...command.rectangle,
    id: command.rectangle.id,
    type: 'rectangle' as const,
    parentId: null,
    transform: [...command.rectangle.transform],
    cornerRadii: [...command.rectangle.cornerRadii],
    fill: command.rectangle.fill === null ? null : { ...command.rectangle.fill },
    stroke:
      command.rectangle.stroke === null
        ? null
        : { paint: { ...command.rectangle.stroke.paint }, width: command.rectangle.stroke.width },
  };
  return insertSubtree(before, {
    kind: 'insert-subtree',
    pageId: command.pageId,
    parentId: command.parentId,
    index: command.index,
    rootId: command.rectangle.id,
    nodes: [rectangle],
  });
}

function deleteNodes(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'delete-nodes' }>,
): Result<DocumentContent> {
  if (!Array.isArray(command.nodeIds)) return failure('value.array', '/nodeIds');
  if (command.nodeIds.length === 0) return failure('array.empty', '/nodeIds');

  const byId = nodeMap(before);
  const targets: SceneNode[] = [];
  const targetIds = new Set<string>();
  for (let index = 0; index < command.nodeIds.length; index += 1) {
    const id = commandId(command.nodeIds[index]!, `/nodeIds/${index}`);
    if (!id.ok) return id;
    if (targetIds.has(id.value)) continue;
    const target = byId.get(id.value)?.node;
    if (target === undefined) return failure('node.not-found', `/nodeIds/${index}`);
    if (pageForNode(before, target.id) !== before.activePageId) {
      return failure('command.source-page-mismatch', `/nodeIds/${index}`);
    }
    targetIds.add(target.id);
    targets.push(target);
  }

  const roots = targets.filter((target) => {
    let parentId = target.parentId;
    while (parentId !== null) {
      if (targetIds.has(parentId)) return false;
      parentId = byId.get(parentId)?.node.parentId ?? null;
    }
    return true;
  });

  const deleted = new Set<string>();
  const protectedIds = new Set<string>();
  for (const root of roots) {
    for (const id of subtreeIds(before, root.id)) {
      deleted.add(id);
      protectedIds.add(id);
    }
    for (const id of ancestorIds(before, root.id)) protectedIds.add(id);
  }
  const locked = firstLocked(before, protectedIds);
  if (!locked.ok) return locked;

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of before.nodes) {
      if (
        node.type === 'group' &&
        node.childIds.length > 0 &&
        !deleted.has(node.id) &&
        node.childIds.every((childId) => deleted.has(childId))
      ) {
        deleted.add(node.id);
        changed = true;
      }
    }
  }

  const pages = before.pages.map((page) => ({
    ...page,
    rootNodeIds: page.rootNodeIds.filter((rootId) => !deleted.has(rootId)),
  }));
  const nodes = before.nodes
    .filter((node) => !deleted.has(node.id))
    .map((node) =>
      isContainer(node)
        ? withChildIds(
            node,
            node.childIds.filter((childId) => !deleted.has(childId)),
          )
        : cloneNode(node),
    );
  return commitCandidate(before, withPagesAndNodes(before, pages, nodes));
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

function isIdentityMatrix(matrix: Matrix): boolean {
  return (
    matrix[0] === 1 &&
    matrix[1] === 0 &&
    matrix[2] === 0 &&
    matrix[3] === 1 &&
    matrix[4] === 0 &&
    matrix[5] === 0
  );
}

function applyTransformDelta(
  before: BringsDocument,
  command: Extract<DocumentCommandInput, { kind: 'apply-transform-delta' }>,
): Result<DocumentContent> {
  if (!Array.isArray(command.nodeIds)) return failure('value.array', '/nodeIds');
  if (command.nodeIds.length === 0) return failure('array.empty', '/nodeIds');
  const delta = validateMatrixInput(command.delta, '/delta');
  if (!delta.ok) return delta;

  const byId = nodeMap(before);
  const targets: SceneNode[] = [];
  const targetIds = new Set<string>();
  for (let index = 0; index < command.nodeIds.length; index += 1) {
    const id = commandId(command.nodeIds[index]!, `/nodeIds/${index}`);
    if (!id.ok) return id;
    if (targetIds.has(id.value)) return failure('id.duplicate', `/nodeIds/${index}`);
    const target = byId.get(id.value)?.node;
    if (target === undefined) return failure('node.not-found', `/nodeIds/${index}`);
    if (pageForNode(before, target.id) !== before.activePageId) {
      return failure('command.source-page-mismatch', `/nodeIds/${index}`);
    }
    targetIds.add(id.value);
    targets.push(target);
  }

  for (let index = 0; index < targets.length; index += 1) {
    let parentId = targets[index]!.parentId;
    while (parentId !== null) {
      if (targetIds.has(parentId)) {
        return failure('command.transform-overlap', `/nodeIds/${index}`);
      }
      parentId = byId.get(parentId)?.node.parentId ?? null;
    }
  }

  const protectedIds = new Set<string>();
  for (const target of targets) {
    for (const id of ancestorIds(before, target.id)) protectedIds.add(id);
  }
  const locked = firstLocked(before, protectedIds);
  if (!locked.ok) return locked;
  if (isIdentityMatrix(delta.value)) return failure('command.no-change', '/');

  const transforms = new Map<string, Matrix>();
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const page = pageMatrixForNode(before, target.id, `/nodeIds/${index}`);
    if (!page.ok) return page;
    let inverseParent: Result<Matrix> = success([1, 0, 0, 1, 0, 0]);
    if (target.parentId !== null) {
      const parent = pageMatrixForNode(before, target.parentId, `/nodeIds/${index}`);
      if (!parent.ok) return parent;
      inverseParent = invertMatrix(parent.value, `/nodeIds/${index}`);
    }
    if (!inverseParent.ok) return inverseParent;
    const local = multiplyMatrices(inverseParent.value, multiplyMatrices(delta.value, page.value));
    const validated = validateMatrixInput(local, `/nodeIds/${index}/transform`);
    if (!validated.ok) return validated;
    transforms.set(target.id, validated.value);
  }

  const nodes = before.nodes.map((node) => {
    const transform = transforms.get(node.id);
    return transform === undefined
      ? cloneNode(node)
      : ({ ...cloneNode(node), transform } as SceneNode);
  });
  return commitCandidate(before, withPagesAndNodes(before, before.pages, nodes));
}

/** Plan one document command without mutating the supplied document or command. */
export function planCommand(
  before: BringsDocument,
  command: DocumentCommandInput,
): Result<DocumentContent> {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    return failure('command.invalid', '/');
  }
  switch (command.kind) {
    case 'create-page':
      return insertPage(before, command);
    case 'rename-page':
      return renamePage(before, command);
    case 'reorder-page':
      return reorderPage(before, command);
    case 'delete-page':
      return deletePage(before, command);
    case 'activate-page':
      return activatePage(before, command);
    case 'create-frame':
      return createFrame(before, command);
    case 'create-rectangle':
      return createRectangle(before, command);
    case 'insert-subtree':
      return insertSubtree(before, command);
    case 'apply-transform-delta':
      return applyTransformDelta(before, command);
    case 'delete-nodes':
      return deleteNodes(before, command);
    case 'delete-node':
      return deleteNode(before, command);
    default:
      return failure('command.kind', '/kind');
  }
}

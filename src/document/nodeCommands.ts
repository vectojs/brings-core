import { cloneNode } from './clone';
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
  subtreeIds,
  withChildIds,
  withParent,
} from './commandShared';
import { invertMatrix, multiplyMatrices, pageMatrixForNode } from '../geometry/matrix';
import { validateMatrixInput } from './validate';
import type {
  BringsDocument,
  DocumentContent,
  Matrix,
  MoveNodesCommand,
  NodeId,
  PageId,
  Result,
  SceneNode,
  SetNodePropertiesCommand,
} from './types';

const propertyKeys = [
  'name',
  'visible',
  'locked',
  'opacity',
  'width',
  'height',
  'cornerRadii',
  'fill',
  'background',
  'stroke',
  'clipChildren',
  'content',
  'fontFamilies',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'horizontalAlign',
  'layoutMode',
] as const;

type PropertyKey = (typeof propertyKeys)[number];
type UnknownRecord = Record<string, unknown>;
type Target = Readonly<{ inputIndex: number; node: SceneNode; nodeIndex: number }>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isPropertyKey(value: string): value is PropertyKey {
  return (propertyKeys as readonly string[]).includes(value);
}

function clonePatchValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePatchValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, clonePatchValue(entry)]),
  );
}

function supportsProperty(node: SceneNode, key: PropertyKey, value: unknown): boolean {
  switch (key) {
    case 'name':
    case 'visible':
    case 'locked':
    case 'opacity':
      return true;
    case 'width':
    case 'height':
      return node.type !== 'group';
    case 'cornerRadii':
      return node.type === 'frame' || node.type === 'rectangle';
    case 'fill':
      return (
        node.type === 'rectangle' ||
        node.type === 'ellipse' ||
        (node.type === 'text' && value !== null)
      );
    case 'background':
    case 'clipChildren':
      return node.type === 'frame';
    case 'stroke':
      return node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse';
    case 'content':
    case 'fontFamilies':
    case 'fontWeight':
    case 'fontSize':
    case 'lineHeight':
    case 'horizontalAlign':
    case 'layoutMode':
      return node.type === 'text';
  }
}

function cloneWithPatch(
  node: SceneNode,
  patch: UnknownRecord,
  keys: readonly PropertyKey[],
): SceneNode {
  const candidate = cloneNode(node) as unknown as UnknownRecord;
  for (const key of keys) candidate[key] = clonePatchValue(patch[key]);
  return candidate as unknown as SceneNode;
}

function contentMatchesDocument(content: DocumentContent, document: BringsDocument): boolean {
  return (
    content.name === document.name &&
    JSON.stringify(content.pageOrder) === JSON.stringify(document.pageOrder) &&
    content.activePageId === document.activePageId &&
    JSON.stringify(content.pages) === JSON.stringify(document.pages) &&
    JSON.stringify(content.nodes) === JSON.stringify(document.nodes)
  );
}

function patchError(error: Result<DocumentContent>, targets: readonly Target[]): Result<never> {
  if (error.ok) return failure('command.invalid', '/');
  for (const target of targets) {
    const prefix = `/nodes/${target.nodeIndex}/`;
    if (error.error.path.startsWith(prefix)) {
      const fieldPath = error.error.path.slice(prefix.length);
      const field = fieldPath.split('/')[0] ?? '';
      if (isPropertyKey(field)) return failure(error.error.code, `/patch/${fieldPath}`);
    }
  }
  return error;
}

function validateTargets(
  before: BringsDocument,
  nodeIds: readonly string[],
): Result<readonly Target[]> {
  if (!Array.isArray(nodeIds)) return failure('value.array', '/nodeIds');
  if (nodeIds.length === 0) return failure('array.empty', '/nodeIds');

  const byId = nodeMap(before);
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (let inputIndex = 0; inputIndex < nodeIds.length; inputIndex += 1) {
    const id = commandId(nodeIds[inputIndex]!, `/nodeIds/${inputIndex}`);
    if (!id.ok) return id;
    if (seen.has(id.value)) return failure('id.duplicate', `/nodeIds/${inputIndex}`);
    const entry = byId.get(id.value);
    if (entry === undefined) return failure('node.not-found', `/nodeIds/${inputIndex}`);
    if (pageForNode(before, entry.node.id) !== before.activePageId) {
      return failure('command.source-page-mismatch', `/nodeIds/${inputIndex}`);
    }
    seen.add(id.value);
    targets.push({ inputIndex, node: entry.node, nodeIndex: entry.index });
  }
  return { ok: true, value: targets };
}

function validatePatch(
  value: unknown,
  targets: readonly Target[],
): Result<Readonly<{ patch: UnknownRecord; keys: readonly PropertyKey[] }>> {
  if (!isRecord(value)) return failure('value.object', '/patch');
  const rawKeys = Object.keys(value);
  if (rawKeys.length === 0) return failure('command.patch-empty', '/patch');
  if (rawKeys.some((key) => !isPropertyKey(key))) return failure('field.unknown', '/patch');
  const keys = propertyKeys.filter((key) => hasOwn(value, key));
  for (const key of keys) {
    for (const target of targets) {
      if (!supportsProperty(target.node, key, value[key])) {
        return failure('command.property-unsupported', `/patch/${key}`);
      }
    }
  }
  return { ok: true, value: { patch: value, keys } };
}

function validateLocks(
  before: BringsDocument,
  targets: readonly Target[],
  keys: readonly PropertyKey[],
): Result<void> {
  const byId = nodeMap(before);
  for (const target of targets) {
    const protectedIds = ancestorIds(before, target.node.id);
    for (const protectedId of protectedIds) {
      const entry = byId.get(protectedId);
      if (entry === undefined || !entry.node.locked) continue;
      const unlocksTarget =
        protectedId === target.node.id && keys.length === 1 && keys[0] === 'locked';
      if (!unlocksTarget) return failure('node.locked', `/nodes/${entry.index}/locked`);
    }
  }
  return { ok: true, value: undefined };
}

/** Plan one atomic, schema-validated patch for compatible active-page nodes. */
export function setNodeProperties(
  before: BringsDocument,
  command: SetNodePropertiesCommand,
): Result<DocumentContent> {
  const targets = validateTargets(before, command.nodeIds);
  if (!targets.ok) return targets;
  const patch = validatePatch(command.patch, targets.value);
  if (!patch.ok) return patch;
  const locks = validateLocks(before, targets.value, patch.value.keys);
  if (!locks.ok) return locks;

  const targetIds = new Set(targets.value.map((target) => target.node.id));
  const nodes = before.nodes.map((node) =>
    targetIds.has(node.id)
      ? cloneWithPatch(node, patch.value.patch, patch.value.keys)
      : cloneNode(node),
  );
  const committed = commitCandidate(before, {
    name: before.name,
    pageOrder: [...before.pageOrder],
    activePageId: before.activePageId,
    pages: before.pages.map((page) => ({ ...page, rootNodeIds: [...page.rootNodeIds] })),
    nodes,
  });
  if (!committed.ok) return patchError(committed, targets.value);
  if (contentMatchesDocument(committed.value, before)) return failure('command.no-change', '/');
  return committed;
}

function validateHierarchyOverlap(
  before: BringsDocument,
  targets: readonly Target[],
): Result<void> {
  for (let left = 0; left < targets.length; left += 1) {
    const leftDescendants = subtreeIds(before, targets[left]!.node.id);
    for (let right = left + 1; right < targets.length; right += 1) {
      const rightNode = targets[right]!.node;
      if (
        leftDescendants.has(rightNode.id) ||
        subtreeIds(before, rightNode.id).has(targets[left]!.node.id)
      ) {
        return failure('command.hierarchy-overlap', `/nodeIds/${targets[right]!.inputIndex}`);
      }
    }
  }
  return { ok: true, value: undefined };
}

type MutablePage = { id: PageId; name: string; rootNodeIds: NodeId[] };

function pruneEmptyGroups(pages: MutablePage[], nodes: Map<NodeId, SceneNode>): void {
  while (true) {
    const empty = new Set(
      [...nodes.values()]
        .filter((node) => node.type === 'group' && node.childIds.length === 0)
        .map((node) => node.id),
    );
    if (empty.size === 0) return;
    for (const nodeId of empty) nodes.delete(nodeId);
    for (const page of pages) {
      page.rootNodeIds = page.rootNodeIds.filter((nodeId) => !empty.has(nodeId));
    }
    for (const node of nodes.values()) {
      if (!isContainer(node)) continue;
      nodes.set(
        node.id,
        withChildIds(
          node,
          node.childIds.filter((childId) => !empty.has(childId)),
        ),
      );
    }
  }
}

function movedRootLocalTransforms(
  before: BringsDocument,
  roots: readonly Target[],
  parentId: NodeId | null,
): Result<ReadonlyMap<NodeId, Matrix>> {
  const destinationPage =
    parentId === null
      ? ({ ok: true, value: [1, 0, 0, 1, 0, 0] as Matrix } as const)
      : pageMatrixForNode(before, parentId, '/parentId');
  if (!destinationPage.ok) return destinationPage;
  const inverse = invertMatrix(destinationPage.value, '/parentId');
  if (!inverse.ok) return inverse;

  const transforms = new Map<NodeId, Matrix>();
  for (const root of roots) {
    if (root.node.parentId === parentId) continue;
    const page = pageMatrixForNode(before, root.node.id, `/nodeIds/${root.inputIndex}`);
    if (!page.ok) return page;
    const local = multiplyMatrices(inverse.value, page.value);
    if (!local.every(Number.isFinite)) {
      return failure('matrix.computation-overflow', `/nodeIds/${root.inputIndex}/transform`);
    }
    const validated = validateMatrixInput(local, `/nodeIds/${root.inputIndex}/transform`);
    if (!validated.ok) return validated;
    transforms.set(root.node.id, validated.value);
  }
  return { ok: true, value: transforms };
}

/** Plan one deterministic active-page reorder or geometry-preserving reparent operation. */
export function moveNodes(
  before: BringsDocument,
  command: MoveNodesCommand,
): Result<DocumentContent> {
  const pageId = commandId(command.pageId, '/pageId');
  if (!pageId.ok) return pageId;
  if (pageIndex(before, pageId.value) === -1) return failure('page.not-found', '/pageId');
  if (pageId.value !== before.activePageId) {
    return failure('command.destination-page-mismatch', '/pageId');
  }

  const targets = validateTargets(before, command.nodeIds);
  if (!targets.ok) return targets;
  const overlap = validateHierarchyOverlap(before, targets.value);
  if (!overlap.ok) return overlap;
  const roots = [...targets.value].sort((left, right) => left.nodeIndex - right.nodeIndex);
  const movedIds = new Set<NodeId>(roots.map((root) => root.node.id));
  const movedSubtreeIds = new Set<string>();
  for (const root of roots) {
    for (const nodeId of subtreeIds(before, root.node.id)) movedSubtreeIds.add(nodeId);
  }

  let parentId: NodeId | null = null;
  if (command.parentId !== null) {
    const parsedParent = commandId(command.parentId, '/parentId');
    if (!parsedParent.ok) return parsedParent;
    const parent = nodeMap(before).get(parsedParent.value);
    if (parent === undefined) return failure('node.not-found', '/parentId');
    if (pageForNode(before, parent.node.id) !== pageId.value) {
      return failure('command.destination-page-mismatch', '/parentId');
    }
    if (!isContainer(parent.node)) return failure('node.destination-not-container', '/parentId');
    if (movedSubtreeIds.has(parent.node.id))
      return failure('command.destination-cycle', '/parentId');
    parentId = parent.node.id;
  }

  const protectedIds = new Set<string>();
  for (const root of roots) {
    for (const nodeId of ancestorIds(before, root.node.id)) protectedIds.add(nodeId);
  }
  if (parentId !== null) {
    for (const nodeId of ancestorIds(before, parentId)) protectedIds.add(nodeId);
  }
  const locked = firstLocked(before, protectedIds);
  if (!locked.ok) return locked;

  const transforms = movedRootLocalTransforms(before, roots, parentId);
  if (!transforms.ok) return transforms;

  const pages: MutablePage[] = before.pages.map((page) => ({
    id: page.id,
    name: page.name,
    rootNodeIds: page.rootNodeIds.filter((nodeId) => !movedIds.has(nodeId)),
  }));
  const nodes = new Map<NodeId, SceneNode>(before.nodes.map((node) => [node.id, cloneNode(node)]));
  for (const node of nodes.values()) {
    if (!isContainer(node)) continue;
    nodes.set(
      node.id,
      withChildIds(
        node,
        node.childIds.filter((childId) => !movedIds.has(childId)),
      ),
    );
  }

  let destinationChildren: NodeId[];
  if (parentId === null) {
    destinationChildren = pages[pageIndex(before, pageId.value)]!.rootNodeIds;
  } else {
    const parent = nodes.get(parentId)!;
    if (!isContainer(parent)) return failure('node.destination-not-container', '/parentId');
    destinationChildren = [...parent.childIds];
  }
  const index = commandIndex(command.index, destinationChildren.length);
  if (!index.ok) return index;
  destinationChildren.splice(index.value, 0, ...roots.map((root) => root.node.id));
  if (parentId !== null) {
    const parent = nodes.get(parentId)!;
    if (!isContainer(parent)) return failure('node.destination-not-container', '/parentId');
    nodes.set(parentId, withChildIds(parent, destinationChildren));
  }

  for (const root of roots) {
    const moved = withParent(nodes.get(root.node.id)!, parentId);
    const transform = transforms.value.get(root.node.id);
    nodes.set(
      root.node.id,
      transform === undefined ? moved : ({ ...moved, transform: [...transform] } as SceneNode),
    );
  }
  pruneEmptyGroups(pages, nodes);

  const candidate = commitCandidate(before, {
    name: before.name,
    pageOrder: pages.map((page) => page.id),
    activePageId: before.activePageId,
    pages,
    nodes: before.nodes.flatMap((node) => {
      const candidateNode = nodes.get(node.id);
      return candidateNode === undefined ? [] : [candidateNode];
    }),
  });
  if (!candidate.ok) return candidate;
  if (contentMatchesDocument(candidate.value, before)) return failure('command.no-change', '/');
  return candidate;
}

import { cloneNode } from './clone';
import { ancestorIds, commitCandidate, failure, nodeMap, pageForNode } from './commandShared';
import type {
  BringsDocument,
  DocumentContent,
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
    const id = nodeIds[inputIndex];
    if (typeof id !== 'string') return failure('id.invalid', `/nodeIds/${inputIndex}`);
    if (seen.has(id)) return failure('id.duplicate', `/nodeIds/${inputIndex}`);
    const entry = byId.get(id);
    if (entry === undefined) return failure('node.not-found', `/nodeIds/${inputIndex}`);
    if (pageForNode(before, entry.node.id) !== before.activePageId) {
      return failure('command.source-page-mismatch', `/nodeIds/${inputIndex}`);
    }
    seen.add(id);
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

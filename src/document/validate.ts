import { MIN_MATRIX_DETERMINANT } from '../geometry/matrix';
import type {
  BringsDocument,
  CommonNode,
  CreateDocumentInput,
  DocumentContent,
  EllipseNode,
  FrameNode,
  GroupNode,
  Matrix,
  NodeId,
  Page,
  PageId,
  Radii,
  RectangleNode,
  Result,
  SceneNode,
  SolidPaint,
  Stroke,
  TextNode,
  UUID,
} from './types';

const MAX_NAME_SCALARS = 1_024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 256;
const MAX_TEXT_BYTES = 1_048_576;
const MAX_TOTAL_TEXT_BYTES = 8_388_608;
const MAX_DIMENSION = 10_000_000;
const MAX_STROKE_WIDTH = 100_000;
const MAX_FONT_FAMILIES = 16;
const MAX_FONT_FAMILY_SCALARS = 256;
const MAX_FONT_MEASURE = 100_000;
const MIN_FONT_MEASURE = 0.1;

type UnknownRecord = Record<string, unknown>;

type ParsedCommonNode = Omit<CommonNode, 'id' | 'parentId'> & {
  id: NodeId;
  parentId: NodeId | null;
};

type NodeEntry = Readonly<{ index: number; node: SceneNode }>;

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function pathAt(parent: string, segment: string | number): string {
  return `${parent}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readRecord(value: unknown, path: string): Result<UnknownRecord> {
  if (!isRecord(value)) return failure('value.object', path || '/');
  return success(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readExactKeys(record: UnknownRecord, keys: readonly string[], path: string): Result<void> {
  for (const key of keys) {
    if (!hasOwn(record, key)) return failure('field.required', pathAt(path, key));
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) return failure('field.unknown', path || '/');
  }
  return success(undefined);
}

function readString(value: unknown, path: string): Result<string> {
  if (typeof value !== 'string') return failure('value.string', path);
  return success(value);
}

function unicodeScalarLength(value: string): number {
  let count = 0;
  for (const _ of value) {
    void _;
    count += 1;
  }
  return count;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) {
      bytes += 1;
      continue;
    }
    if (first <= 0x7ff) {
      bytes += 2;
      continue;
    }
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        bytes += 4;
        index += 1;
        continue;
      }
    }
    bytes += 3;
  }
  return bytes;
}

function readBoundedString(value: unknown, path: string, maximum: number): Result<string> {
  const text = readString(value, path);
  if (!text.ok) return text;
  if (unicodeScalarLength(text.value) > maximum) return failure('string.length', path);
  return text;
}

function readBoolean(value: unknown, path: string): Result<boolean> {
  if (typeof value !== 'boolean') return failure('value.boolean', path);
  return success(value);
}

function readFiniteRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): Result<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return failure('number.finite', path);
  if (value < minimum || value > maximum) return failure('number.range', path);
  return success(value);
}

function readRevision(value: unknown): Result<number> {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    return failure('revision.invalid', '/revision');
  }
  return success(value);
}

/** Check the strict UUID syntax required by schema-v1 document values. */
export function isLowercaseRfc4122Uuid(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function readUuid(value: unknown, path: string): Result<UUID> {
  if (typeof value !== 'string' || !isLowercaseRfc4122Uuid(value)) {
    return failure('id.invalid', path);
  }
  return success(value);
}

function readUuidArray(
  value: unknown,
  path: string,
  requireNonEmpty: boolean,
): Result<readonly UUID[]> {
  if (!Array.isArray(value)) return failure('value.array', path);
  if (requireNonEmpty && value.length === 0) return failure('array.empty', path);
  const values: UUID[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = readUuid(value[index], pathAt(path, index));
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value)) return failure('node.duplicate-reference', pathAt(path, index));
    seen.add(parsed.value);
    values.push(parsed.value);
  }
  return success(values);
}

/** Validate one raw affine matrix without retaining caller-owned array state. */
export function validateMatrixInput(value: unknown, path: string): Result<Matrix> {
  if (!Array.isArray(value) || value.length !== 6) return failure('matrix.invalid', path);
  const values: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const number = readFiniteRange(
      value[index],
      pathAt(path, index),
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
    );
    if (!number.ok) return failure('matrix.invalid', pathAt(path, index));
    values.push(number.value);
  }
  if (Math.abs(values[0]! * values[3]! - values[1]! * values[2]!) < MIN_MATRIX_DETERMINANT) {
    return failure('matrix.singular', path);
  }
  return success([values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!]);
}

function readRadii(value: unknown, path: string, width: number, height: number): Result<Radii> {
  if (!Array.isArray(value) || value.length !== 4) return failure('radii.invalid', path);
  const maximum = Math.min(width, height) / 2;
  const values: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const radius = readFiniteRange(value[index], pathAt(path, index), 0, maximum);
    if (!radius.ok) return radius;
    values.push(radius.value);
  }
  return success([values[0]!, values[1]!, values[2]!, values[3]!]);
}

function readSolidPaint(value: unknown, path: string): Result<SolidPaint> {
  const record = readRecord(value, path);
  if (!record.ok) return record;
  const exact = readExactKeys(record.value, ['type', 'r', 'g', 'b', 'a'], path);
  if (!exact.ok) return exact;
  if (record.value.type !== 'solid') return failure('paint.type', pathAt(path, 'type'));
  const r = readFiniteRange(record.value.r, pathAt(path, 'r'), 0, 1);
  if (!r.ok) return r;
  const g = readFiniteRange(record.value.g, pathAt(path, 'g'), 0, 1);
  if (!g.ok) return g;
  const b = readFiniteRange(record.value.b, pathAt(path, 'b'), 0, 1);
  if (!b.ok) return b;
  const a = readFiniteRange(record.value.a, pathAt(path, 'a'), 0, 1);
  if (!a.ok) return a;
  return success({ type: 'solid', r: r.value, g: g.value, b: b.value, a: a.value });
}

function readOptionalPaint(value: unknown, path: string): Result<SolidPaint | null> {
  if (value === null) return success(null);
  return readSolidPaint(value, path);
}

function readOptionalStroke(value: unknown, path: string): Result<Stroke | null> {
  if (value === null) return success(null);
  const record = readRecord(value, path);
  if (!record.ok) return record;
  const exact = readExactKeys(record.value, ['paint', 'width'], path);
  if (!exact.ok) return exact;
  const paint = readSolidPaint(record.value.paint, pathAt(path, 'paint'));
  if (!paint.ok) return paint;
  const width = readFiniteRange(record.value.width, pathAt(path, 'width'), 0, MAX_STROKE_WIDTH);
  if (!width.ok) return width;
  return success({ paint: paint.value, width: width.value });
}

function readCommonNode(record: UnknownRecord, path: string): Result<ParsedCommonNode> {
  const id = readUuid(record.id, pathAt(path, 'id'));
  if (!id.ok) return id;
  const name = readBoundedString(record.name, pathAt(path, 'name'), MAX_NAME_SCALARS);
  if (!name.ok) return name;
  let parentId: NodeId | null = null;
  if (record.parentId !== null) {
    const parent = readUuid(record.parentId, pathAt(path, 'parentId'));
    if (!parent.ok) return parent;
    parentId = parent.value as NodeId;
  }
  const visible = readBoolean(record.visible, pathAt(path, 'visible'));
  if (!visible.ok) return visible;
  const locked = readBoolean(record.locked, pathAt(path, 'locked'));
  if (!locked.ok) return locked;
  const opacity = readFiniteRange(record.opacity, pathAt(path, 'opacity'), 0, 1);
  if (!opacity.ok) return opacity;
  const transform = validateMatrixInput(record.transform, pathAt(path, 'transform'));
  if (!transform.ok) return transform;
  return success({
    id: id.value as NodeId,
    name: name.value,
    parentId,
    visible: visible.value,
    locked: locked.value,
    opacity: opacity.value,
    transform: transform.value,
  });
}

function childIdsOf(node: SceneNode): readonly NodeId[] {
  return node.type === 'frame' || node.type === 'group' ? node.childIds : [];
}

function isContainer(node: SceneNode): node is FrameNode | GroupNode {
  return node.type === 'frame' || node.type === 'group';
}

function readTextContent(
  value: unknown,
  path: string,
  totalBytes: { value: number },
): Result<string> {
  const content = readString(value, path);
  if (!content.ok) return content;
  const bytes = utf8ByteLength(content.value);
  if (bytes > MAX_TEXT_BYTES || totalBytes.value + bytes > MAX_TOTAL_TEXT_BYTES) {
    return failure('text.length', path);
  }
  totalBytes.value += bytes;
  return content;
}

function readFontFamilies(value: unknown, path: string): Result<readonly [string, ...string[]]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FONT_FAMILIES) {
    return failure('font.families', path);
  }
  const families: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const family = readBoundedString(value[index], pathAt(path, index), MAX_FONT_FAMILY_SCALARS);
    if (!family.ok) return family;
    if (family.value.length === 0) return failure('font.family-empty', pathAt(path, index));
    families.push(family.value);
  }
  return success(families as [string, ...string[]]);
}

function readTextWeight(value: unknown, path: string): Result<TextNode['fontWeight']> {
  if (
    value !== 100 &&
    value !== 200 &&
    value !== 300 &&
    value !== 400 &&
    value !== 500 &&
    value !== 600 &&
    value !== 700 &&
    value !== 800 &&
    value !== 900
  ) {
    return failure('text.font-weight', path);
  }
  return success(value);
}

function readNode(
  value: unknown,
  path: string,
  totalTextBytes: { value: number },
): Result<SceneNode> {
  const record = readRecord(value, path);
  if (!record.ok) return record;
  const rawType = record.value.type;
  if (
    rawType !== 'frame' &&
    rawType !== 'group' &&
    rawType !== 'rectangle' &&
    rawType !== 'ellipse' &&
    rawType !== 'text'
  ) {
    return failure('node.type', pathAt(path, 'type'));
  }
  if (
    (rawType === 'rectangle' || rawType === 'ellipse' || rawType === 'text') &&
    hasOwn(record.value, 'childIds')
  ) {
    return failure('node.leaf-children', pathAt(path, 'childIds'));
  }

  const commonKeys = [
    'id',
    'type',
    'name',
    'parentId',
    'visible',
    'locked',
    'opacity',
    'transform',
  ];
  const typeKeys: Record<SceneNode['type'], readonly string[]> = {
    frame: ['childIds', 'width', 'height', 'cornerRadii', 'background', 'stroke', 'clipChildren'],
    group: ['childIds'],
    rectangle: ['width', 'height', 'cornerRadii', 'fill', 'stroke'],
    ellipse: ['width', 'height', 'fill', 'stroke'],
    text: [
      'content',
      'fontFamilies',
      'fontWeight',
      'fontSize',
      'lineHeight',
      'horizontalAlign',
      'layoutMode',
      'width',
      'height',
      'fill',
    ],
  };
  const exact = readExactKeys(record.value, [...commonKeys, ...typeKeys[rawType]], path);
  if (!exact.ok) return exact;
  const common = readCommonNode(record.value, path);
  if (!common.ok) return common;

  switch (rawType) {
    case 'frame': {
      const childIds = readUuidArray(record.value.childIds, pathAt(path, 'childIds'), false);
      if (!childIds.ok) return childIds;
      const width = readFiniteRange(record.value.width, pathAt(path, 'width'), 1, MAX_DIMENSION);
      if (!width.ok) return width;
      const height = readFiniteRange(record.value.height, pathAt(path, 'height'), 1, MAX_DIMENSION);
      if (!height.ok) return height;
      const cornerRadii = readRadii(
        record.value.cornerRadii,
        pathAt(path, 'cornerRadii'),
        width.value,
        height.value,
      );
      if (!cornerRadii.ok) return cornerRadii;
      const background = readOptionalPaint(record.value.background, pathAt(path, 'background'));
      if (!background.ok) return background;
      const stroke = readOptionalStroke(record.value.stroke, pathAt(path, 'stroke'));
      if (!stroke.ok) return stroke;
      const clipChildren = readBoolean(record.value.clipChildren, pathAt(path, 'clipChildren'));
      if (!clipChildren.ok) return clipChildren;
      const node: FrameNode = {
        ...common.value,
        type: 'frame',
        childIds: childIds.value as readonly NodeId[],
        width: width.value,
        height: height.value,
        cornerRadii: cornerRadii.value,
        background: background.value,
        stroke: stroke.value,
        clipChildren: clipChildren.value,
      };
      return success(node);
    }
    case 'group': {
      const childIds = readUuidArray(record.value.childIds, pathAt(path, 'childIds'), false);
      if (!childIds.ok) return childIds;
      if (childIds.value.length === 0) return failure('node.group-empty', pathAt(path, 'childIds'));
      const node: GroupNode = {
        ...common.value,
        type: 'group',
        childIds: childIds.value as [NodeId, ...NodeId[]],
      };
      return success(node);
    }
    case 'rectangle': {
      const width = readFiniteRange(record.value.width, pathAt(path, 'width'), 1, MAX_DIMENSION);
      if (!width.ok) return width;
      const height = readFiniteRange(record.value.height, pathAt(path, 'height'), 1, MAX_DIMENSION);
      if (!height.ok) return height;
      const cornerRadii = readRadii(
        record.value.cornerRadii,
        pathAt(path, 'cornerRadii'),
        width.value,
        height.value,
      );
      if (!cornerRadii.ok) return cornerRadii;
      const fill = readOptionalPaint(record.value.fill, pathAt(path, 'fill'));
      if (!fill.ok) return fill;
      const stroke = readOptionalStroke(record.value.stroke, pathAt(path, 'stroke'));
      if (!stroke.ok) return stroke;
      const node: RectangleNode = {
        ...common.value,
        type: 'rectangle',
        width: width.value,
        height: height.value,
        cornerRadii: cornerRadii.value,
        fill: fill.value,
        stroke: stroke.value,
      };
      return success(node);
    }
    case 'ellipse': {
      const width = readFiniteRange(record.value.width, pathAt(path, 'width'), 1, MAX_DIMENSION);
      if (!width.ok) return width;
      const height = readFiniteRange(record.value.height, pathAt(path, 'height'), 1, MAX_DIMENSION);
      if (!height.ok) return height;
      const fill = readOptionalPaint(record.value.fill, pathAt(path, 'fill'));
      if (!fill.ok) return fill;
      const stroke = readOptionalStroke(record.value.stroke, pathAt(path, 'stroke'));
      if (!stroke.ok) return stroke;
      const node: EllipseNode = {
        ...common.value,
        type: 'ellipse',
        width: width.value,
        height: height.value,
        fill: fill.value,
        stroke: stroke.value,
      };
      return success(node);
    }
    case 'text': {
      const content = readTextContent(
        record.value.content,
        pathAt(path, 'content'),
        totalTextBytes,
      );
      if (!content.ok) return content;
      const fontFamilies = readFontFamilies(
        record.value.fontFamilies,
        pathAt(path, 'fontFamilies'),
      );
      if (!fontFamilies.ok) return fontFamilies;
      const fontWeight = readTextWeight(record.value.fontWeight, pathAt(path, 'fontWeight'));
      if (!fontWeight.ok) return fontWeight;
      const fontSize = readFiniteRange(
        record.value.fontSize,
        pathAt(path, 'fontSize'),
        MIN_FONT_MEASURE,
        MAX_FONT_MEASURE,
      );
      if (!fontSize.ok) return fontSize;
      const lineHeight = readFiniteRange(
        record.value.lineHeight,
        pathAt(path, 'lineHeight'),
        MIN_FONT_MEASURE,
        MAX_FONT_MEASURE,
      );
      if (!lineHeight.ok) return lineHeight;
      if (
        record.value.horizontalAlign !== 'left' &&
        record.value.horizontalAlign !== 'center' &&
        record.value.horizontalAlign !== 'right'
      ) {
        return failure('text.align', pathAt(path, 'horizontalAlign'));
      }
      if (record.value.layoutMode !== 'fixedBox' && record.value.layoutMode !== 'autoWidth') {
        return failure('text.layout', pathAt(path, 'layoutMode'));
      }
      const width = readFiniteRange(record.value.width, pathAt(path, 'width'), 1, MAX_DIMENSION);
      if (!width.ok) return width;
      const height = readFiniteRange(record.value.height, pathAt(path, 'height'), 1, MAX_DIMENSION);
      if (!height.ok) return height;
      const fill = readSolidPaint(record.value.fill, pathAt(path, 'fill'));
      if (!fill.ok) return fill;
      const node: TextNode = {
        ...common.value,
        type: 'text',
        content: content.value,
        fontFamilies: fontFamilies.value,
        fontWeight: fontWeight.value,
        fontSize: fontSize.value,
        lineHeight: lineHeight.value,
        horizontalAlign: record.value.horizontalAlign,
        layoutMode: record.value.layoutMode,
        width: width.value,
        height: height.value,
        fill: fill.value,
      };
      return success(node);
    }
  }
}

function validateTopology(pages: readonly Page[], nodes: readonly SceneNode[]): Result<void> {
  const byId = new Map<string, NodeEntry>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (byId.has(node.id)) return failure('id.duplicate', pathAt(pathAt('/nodes', index), 'id'));
    byId.set(node.id, { index, node });
  }

  const childMembership = new Map<string, string>();
  for (const entry of byId.values()) {
    const { node, index } = entry;
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent === undefined)
        return failure('node.dangling', pathAt(pathAt('/nodes', index), 'parentId'));
      if (!isContainer(parent.node))
        return failure('node.parent-leaf', pathAt(pathAt('/nodes', index), 'parentId'));
    }
    for (let childIndex = 0; childIndex < childIdsOf(node).length; childIndex += 1) {
      const childId = childIdsOf(node)[childIndex]!;
      const child = byId.get(childId);
      if (child === undefined)
        return failure(
          'node.dangling',
          pathAt(pathAt(pathAt('/nodes', index), 'childIds'), childIndex),
        );
      if (childMembership.has(childId)) {
        return failure(
          'node.multiple-reachability',
          pathAt(pathAt(pathAt('/nodes', index), 'childIds'), childIndex),
        );
      }
      childMembership.set(childId, node.id);
      if (child.node.parentId !== node.id) {
        return failure('node.parent-mismatch', pathAt(pathAt('/nodes', child.index), 'parentId'));
      }
    }
  }

  const rootMembership = new Map<string, number>();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    for (let rootIndex = 0; rootIndex < page.rootNodeIds.length; rootIndex += 1) {
      const rootId = page.rootNodeIds[rootIndex]!;
      const root = byId.get(rootId);
      const rootPath = pathAt(pathAt(pathAt('/pages', pageIndex), 'rootNodeIds'), rootIndex);
      if (root === undefined) return failure('node.dangling', rootPath);
      if (root.node.parentId !== null)
        return failure('node.parent-mismatch', pathAt(pathAt('/nodes', root.index), 'parentId'));
      if (rootMembership.has(rootId)) return failure('node.multiple-reachability', rootPath);
      rootMembership.set(rootId, pageIndex);
    }
  }

  const colors = new Map<string, 0 | 1 | 2>();
  const visit = (nodeId: NodeId, depth: number): Result<void> => {
    const entry = byId.get(nodeId)!;
    const color = colors.get(nodeId) ?? 0;
    if (color === 1) return failure('node.cycle', pathAt(pathAt('/nodes', entry.index), 'id'));
    if (color === 2) return success(undefined);
    if (depth > MAX_DEPTH)
      return failure('node.depth', pathAt(pathAt('/nodes', entry.index), 'id'));
    colors.set(nodeId, 1);
    for (const childId of childIdsOf(entry.node)) {
      const child = visit(childId, depth + 1);
      if (!child.ok) return child;
    }
    colors.set(nodeId, 2);
    return success(undefined);
  };
  for (const node of nodes) {
    const visited = visit(node.id, 1);
    if (!visited.ok) return visited;
  }

  for (const entry of byId.values()) {
    if (entry.node.parentId === null && !rootMembership.has(entry.node.id)) {
      return failure('node.unreachable', pathAt(pathAt('/nodes', entry.index), 'id'));
    }
    if (entry.node.parentId !== null && !childMembership.has(entry.node.id)) {
      return failure('node.unreachable', pathAt(pathAt('/nodes', entry.index), 'parentId'));
    }
  }

  const preorder: NodeId[] = [];
  const seen = new Set<string>();
  const appendPreorder = (nodeId: NodeId): Result<void> => {
    if (seen.has(nodeId)) return failure('node.multiple-reachability', '/nodes');
    seen.add(nodeId);
    preorder.push(nodeId);
    const entry = byId.get(nodeId)!;
    for (const childId of childIdsOf(entry.node)) {
      const appended = appendPreorder(childId);
      if (!appended.ok) return appended;
    }
    return success(undefined);
  };
  for (const page of pages) {
    for (const rootId of page.rootNodeIds) {
      const appended = appendPreorder(rootId);
      if (!appended.ok) return appended;
    }
  }
  if (preorder.length !== nodes.length) {
    const missing = nodes.findIndex((node) => !seen.has(node.id));
    return failure('node.unreachable', pathAt(pathAt('/nodes', missing), 'id'));
  }
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index]!.id !== preorder[index])
      return failure('node.order', pathAt(pathAt('/nodes', index), 'id'));
  }
  return success(undefined);
}

/** Validate and detach a raw schema-v1 document value. */
export function validateDocument(value: unknown): Result<BringsDocument> {
  const record = readRecord(value, '');
  if (!record.ok) return record;
  const exact = readExactKeys(
    record.value,
    ['id', 'revision', 'name', 'pageOrder', 'activePageId', 'pages', 'nodes'],
    '',
  );
  if (!exact.ok) return exact;
  const id = readUuid(record.value.id, '/id');
  if (!id.ok) return id;
  const revision = readRevision(record.value.revision);
  if (!revision.ok) return revision;
  const name = readBoundedString(record.value.name, '/name', MAX_NAME_SCALARS);
  if (!name.ok) return name;
  if (!Array.isArray(record.value.pageOrder) || record.value.pageOrder.length === 0) {
    return failure('page.order', '/pageOrder');
  }
  const pageOrder: PageId[] = [];
  const pageIds = new Set<string>();
  for (let index = 0; index < record.value.pageOrder.length; index += 1) {
    const pageId = readUuid(record.value.pageOrder[index], pathAt('/pageOrder', index));
    if (!pageId.ok) return pageId;
    if (pageIds.has(pageId.value)) return failure('id.duplicate', pathAt('/pageOrder', index));
    if (pageId.value === id.value) return failure('id.duplicate', pathAt('/pageOrder', index));
    pageIds.add(pageId.value);
    pageOrder.push(pageId.value as PageId);
  }
  const activePageId = readUuid(record.value.activePageId, '/activePageId');
  if (!activePageId.ok) return activePageId;
  if (!Array.isArray(record.value.pages) || record.value.pages.length !== pageOrder.length) {
    const pagesLength = Array.isArray(record.value.pages) ? record.value.pages.length : 0;
    const mismatchIndex = Math.min(pagesLength, pageOrder.length);
    return failure('page.order', pathAt(pathAt('/pages', mismatchIndex), 'id'));
  }
  const pages: Page[] = [];
  for (let index = 0; index < record.value.pages.length; index += 1) {
    const pageRecord = readRecord(record.value.pages[index], pathAt('/pages', index));
    if (!pageRecord.ok) return pageRecord;
    const pageExact = readExactKeys(
      pageRecord.value,
      ['id', 'name', 'rootNodeIds'],
      pathAt('/pages', index),
    );
    if (!pageExact.ok) return pageExact;
    const pageId = readUuid(pageRecord.value.id, pathAt(pathAt('/pages', index), 'id'));
    if (!pageId.ok) return pageId;
    if (pageId.value !== pageOrder[index])
      return failure('page.order', pathAt(pathAt('/pages', index), 'id'));
    const pageName = readBoundedString(
      pageRecord.value.name,
      pathAt(pathAt('/pages', index), 'name'),
      MAX_NAME_SCALARS,
    );
    if (!pageName.ok) return pageName;
    const rootIds = readUuidArray(
      pageRecord.value.rootNodeIds,
      pathAt(pathAt('/pages', index), 'rootNodeIds'),
      false,
    );
    if (!rootIds.ok) return rootIds;
    pages.push({
      id: pageId.value as PageId,
      name: pageName.value,
      rootNodeIds: rootIds.value as readonly NodeId[],
    });
  }
  if (!pageIds.has(activePageId.value)) return failure('page.active-not-found', '/activePageId');
  if (!Array.isArray(record.value.nodes) || record.value.nodes.length > MAX_NODES) {
    return failure('nodes.limit', '/nodes');
  }
  const totalTextBytes = { value: 0 };
  const nodes: SceneNode[] = [];
  const nodeIds = new Set<string>();
  for (let index = 0; index < record.value.nodes.length; index += 1) {
    const node = readNode(record.value.nodes[index], pathAt('/nodes', index), totalTextBytes);
    if (!node.ok) return node;
    if (pageIds.has(node.value.id) || nodeIds.has(node.value.id)) {
      return failure('id.duplicate', pathAt(pathAt('/nodes', index), 'id'));
    }
    nodeIds.add(node.value.id);
    nodes.push(node.value);
  }
  const topology = validateTopology(pages, nodes);
  if (!topology.ok) return topology;

  const content: DocumentContent = {
    name: name.value,
    pageOrder,
    activePageId: activePageId.value as PageId,
    pages,
    nodes,
  };
  return success({ id: id.value, revision: revision.value, ...content });
}

/**
 * Validate an insertion forest without allocating identity or depending on a
 * document page. The returned order is the required detached preorder.
 */
export function validateDetachedSubtree(
  value: unknown,
  rootIdValue: string,
): Result<readonly SceneNode[]> {
  const rootId = readUuid(rootIdValue, '/rootId');
  if (!rootId.ok) return rootId;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_NODES) {
    return failure('nodes.limit', '/nodes');
  }
  const textBytes = { value: 0 };
  const nodes: SceneNode[] = [];
  const nodeIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const node = readNode(value[index], pathAt('/nodes', index), textBytes);
    if (!node.ok) return node;
    if (nodeIds.has(node.value.id))
      return failure('id.duplicate', pathAt(pathAt('/nodes', index), 'id'));
    nodeIds.add(node.value.id);
    nodes.push(node.value);
  }
  const root = nodes.find((node) => node.id === rootId.value);
  if (root === undefined || root.parentId !== null) return failure('node.root', '/rootId');
  const topology = validateTopology(
    [{ id: rootId.value as PageId, name: 'Detached root', rootNodeIds: [rootId.value as NodeId] }],
    nodes,
  );
  if (!topology.ok) return topology;
  return success(nodes);
}

/** Create a detached revision-zero document from caller-provided identities. */
export function createDocument(input: CreateDocumentInput): Result<BringsDocument> {
  const record = readRecord(input, '');
  if (!record.ok) return record;
  const exact = readExactKeys(record.value, ['id', 'name', 'initialPage'], '');
  if (!exact.ok) return exact;
  const id = readUuid(record.value.id, '/id');
  if (!id.ok) return id;
  const name = readBoundedString(record.value.name, '/name', MAX_NAME_SCALARS);
  if (!name.ok) return name;
  const initialPage = readRecord(record.value.initialPage, '/initialPage');
  if (!initialPage.ok) return initialPage;
  const initialExact = readExactKeys(initialPage.value, ['id', 'name'], '/initialPage');
  if (!initialExact.ok) return initialExact;
  const pageId = readUuid(initialPage.value.id, '/initialPage/id');
  if (!pageId.ok) return pageId;
  if (pageId.value === id.value) return failure('id.duplicate', '/initialPage/id');
  const pageName = readBoundedString(initialPage.value.name, '/initialPage/name', MAX_NAME_SCALARS);
  if (!pageName.ok) return pageName;
  return validateDocument({
    id: id.value,
    revision: 0,
    name: name.value,
    pageOrder: [pageId.value],
    activePageId: pageId.value,
    pages: [{ id: pageId.value, name: pageName.value, rootNodeIds: [] }],
    nodes: [],
  });
}

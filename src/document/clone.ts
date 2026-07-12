import type {
  BringsDocument,
  DocumentContent,
  FrameNode,
  Matrix,
  Page,
  Radii,
  SceneNode,
  SolidPaint,
  Stroke,
  StructuralSelection,
} from './types';

function cloneMatrix(matrix: Matrix): Matrix {
  return [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]];
}

function cloneRadii(radii: Radii): Radii {
  return [radii[0], radii[1], radii[2], radii[3]];
}

function clonePaint(paint: SolidPaint): SolidPaint {
  return { type: 'solid', r: paint.r, g: paint.g, b: paint.b, a: paint.a };
}

function cloneOptionalPaint(paint: SolidPaint | null): SolidPaint | null {
  return paint === null ? null : clonePaint(paint);
}

function cloneStroke(stroke: Stroke | null): Stroke | null {
  return stroke === null ? null : { paint: clonePaint(stroke.paint), width: stroke.width };
}

function clonePage(page: Page): Page {
  return { id: page.id, name: page.name, rootNodeIds: [...page.rootNodeIds] };
}

/** Return a detached copy of one validated scene node. */
export function cloneNode(node: SceneNode): SceneNode {
  const common = {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    transform: cloneMatrix(node.transform),
  };

  switch (node.type) {
    case 'frame': {
      const frame: FrameNode = {
        ...common,
        type: 'frame',
        childIds: [...node.childIds],
        width: node.width,
        height: node.height,
        cornerRadii: cloneRadii(node.cornerRadii),
        background: cloneOptionalPaint(node.background),
        stroke: cloneStroke(node.stroke),
        clipChildren: node.clipChildren,
      };
      return frame;
    }
    case 'group':
      return {
        ...common,
        type: 'group',
        childIds: [...node.childIds] as [typeof node.id, ...(typeof node.id)[]],
      };
    case 'rectangle':
      return {
        ...common,
        type: 'rectangle',
        width: node.width,
        height: node.height,
        cornerRadii: cloneRadii(node.cornerRadii),
        fill: cloneOptionalPaint(node.fill),
        stroke: cloneStroke(node.stroke),
      };
    case 'ellipse':
      return {
        ...common,
        type: 'ellipse',
        width: node.width,
        height: node.height,
        fill: cloneOptionalPaint(node.fill),
        stroke: cloneStroke(node.stroke),
      };
    case 'text':
      return {
        ...common,
        type: 'text',
        content: node.content,
        fontFamilies: [...node.fontFamilies] as [string, ...string[]],
        fontWeight: node.fontWeight,
        fontSize: node.fontSize,
        lineHeight: node.lineHeight,
        horizontalAlign: node.horizontalAlign,
        layoutMode: node.layoutMode,
        width: node.width,
        height: node.height,
        fill: clonePaint(node.fill),
      };
  }
}

/** Return a detached copy of durable content without identity or revision. */
export function cloneContent(content: DocumentContent): DocumentContent {
  return {
    name: content.name,
    pageOrder: [...content.pageOrder],
    activePageId: content.activePageId,
    pages: content.pages.map(clonePage),
    nodes: content.nodes.map(cloneNode),
  };
}

/** Return a detached document snapshot. */
export function cloneDocument(document: BringsDocument): BringsDocument {
  return {
    id: document.id,
    revision: document.revision,
    ...cloneContent(document),
  };
}

/** Extract detached durable content from a document snapshot. */
export function cloneDocumentContent(document: BringsDocument): DocumentContent {
  return cloneContent(document);
}

/** Return the only currently valid structural selection value. */
export function emptyStructuralSelection(): StructuralSelection {
  return { nodeIds: [], activeNodeId: null };
}

/** Return a detached structural selection snapshot. */
export function cloneStructuralSelection(selection: StructuralSelection): StructuralSelection {
  void selection;
  return emptyStructuralSelection();
}

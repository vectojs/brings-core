/** A machine-readable validation or command failure. */
export type BringsError = Readonly<{
  code: string;
  path: string;
}>;

/** The only public success/failure protocol used by the document core. */
export type Result<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: BringsError }>;

/** A lowercase RFC-4122 UUID validated at a public document boundary. */
export type UUID = string & { readonly __brand: 'BringsUuid' };

/** A UUID used as a page identity. */
export type PageId = UUID & { readonly __page: 'BringsPage' };

/** A UUID used as a scene-node identity. */
export type NodeId = UUID & { readonly __node: 'BringsNode' };

/** A parent-local affine transform `[a, b, c, d, tx, ty]`. */
export type Matrix = readonly [number, number, number, number, number, number];

/** Rectangle or frame corner radii in top-left clockwise order. */
export type Radii = readonly [number, number, number, number];

/** A schema-v1 inline solid paint. */
export type SolidPaint = Readonly<{
  type: 'solid';
  r: number;
  g: number;
  b: number;
  a: number;
}>;

/** A centered inline stroke. */
export type Stroke = Readonly<{
  paint: SolidPaint;
  width: number;
}>;

/** One local-space point or endpoint-relative control vector in a Path. */
export type PathPoint = Readonly<{
  x: number;
  y: number;
}>;

/** One stable vertex in a Path network. */
export type PathVertex = Readonly<{
  id: UUID;
  position: PathPoint;
}>;

/** One cubic segment whose controls are relative to their respective endpoints. */
export type PathSegment = Readonly<{
  id: UUID;
  startVertexId: UUID;
  endVertexId: UUID;
  startControl: PathPoint;
  endControl: PathPoint;
}>;

/** A non-branching collection of open chains or closed cycles. */
export type PathNetwork = Readonly<{
  vertices: readonly [PathVertex, PathVertex, ...PathVertex[]];
  segments: readonly [PathSegment, ...PathSegment[]];
}>;

/** Ordered root-node container for one document page. */
export type Page = Readonly<{
  id: PageId;
  name: string;
  rootNodeIds: readonly NodeId[];
}>;

/** Fields every schema-v1 node shares. */
export type CommonNode = Readonly<{
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Matrix;
}>;

/** A rectangular container with optional clipping. */
export type FrameNode = CommonNode &
  Readonly<{
    type: 'frame';
    childIds: readonly NodeId[];
    width: number;
    height: number;
    cornerRadii: Radii;
    background: SolidPaint | null;
    stroke: Stroke | null;
    clipChildren: boolean;
  }>;

/** A non-empty, non-visual child container. */
export type GroupNode = CommonNode &
  Readonly<{
    type: 'group';
    childIds: readonly [NodeId, ...NodeId[]];
  }>;

/** A rectangular leaf node. */
export type RectangleNode = CommonNode &
  Readonly<{
    type: 'rectangle';
    width: number;
    height: number;
    cornerRadii: Radii;
    fill: SolidPaint | null;
    stroke: Stroke | null;
  }>;

/** An elliptical leaf node. */
export type EllipseNode = CommonNode &
  Readonly<{
    type: 'ellipse';
    width: number;
    height: number;
    fill: SolidPaint | null;
    stroke: Stroke | null;
  }>;

/** A cubic vector-network leaf node. */
export type PathNode = CommonNode &
  Readonly<{
    type: 'path';
    network: PathNetwork;
    fillRule: 'nonzero' | 'evenodd';
    fill: SolidPaint | null;
    stroke: Stroke | null;
  }>;

/** A text leaf node with explicit measured box geometry. */
export type TextNode = CommonNode &
  Readonly<{
    type: 'text';
    content: string;
    fontFamilies: readonly [string, ...string[]];
    fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
    fontSize: number;
    lineHeight: number;
    horizontalAlign: 'left' | 'center' | 'right';
    layoutMode: 'fixedBox' | 'autoWidth';
    width: number;
    height: number;
    fill: SolidPaint;
  }>;

/** Every validated schema-v1 node. */
export type SceneNode = FrameNode | GroupNode | RectangleNode | EllipseNode | PathNode | TextNode;

/** All durable state except document identity and revision. */
export type DocumentContent = Readonly<{
  name: string;
  pageOrder: readonly PageId[];
  activePageId: PageId;
  pages: readonly Page[];
  nodes: readonly SceneNode[];
}>;

/** An immutable, fully validated Brings document snapshot. */
export type BringsDocument = Readonly<
  {
    id: UUID;
    revision: number;
  } & DocumentContent
>;

/** Raw page input accepted at public document boundaries. */
export type PageInput = Readonly<{
  id: string;
  name: string;
  rootNodeIds: readonly string[];
}>;

/** Raw common-node fields accepted at public document boundaries. */
export type CommonNodeInput = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: readonly number[];
}>;

/** Raw solid paint input. */
export type SolidPaintInput = Readonly<{
  type: 'solid';
  r: number;
  g: number;
  b: number;
  a: number;
}>;

/** Raw stroke input. */
export type StrokeInput = Readonly<{
  paint: SolidPaintInput;
  width: number;
}>;

/** Raw Path point input. */
export type PathPointInput = Readonly<{
  x: number;
  y: number;
}>;

/** Raw Path vertex input. */
export type PathVertexInput = Readonly<{
  id: string;
  position: PathPointInput;
}>;

/** Raw Path segment input. */
export type PathSegmentInput = Readonly<{
  id: string;
  startVertexId: string;
  endVertexId: string;
  startControl: PathPointInput;
  endControl: PathPointInput;
}>;

/** Raw Path network input. */
export type PathNetworkInput = Readonly<{
  vertices: readonly PathVertexInput[];
  segments: readonly PathSegmentInput[];
}>;

/** Raw Frame input. */
export type FrameNodeInput = CommonNodeInput &
  Readonly<{
    type: 'frame';
    childIds: readonly string[];
    width: number;
    height: number;
    cornerRadii: readonly number[];
    background: SolidPaintInput | null;
    stroke: StrokeInput | null;
    clipChildren: boolean;
  }>;

/** Raw Group input. */
export type GroupNodeInput = CommonNodeInput &
  Readonly<{
    type: 'group';
    childIds: readonly string[];
  }>;

/** Raw Rectangle input. */
export type RectangleNodeInput = CommonNodeInput &
  Readonly<{
    type: 'rectangle';
    width: number;
    height: number;
    cornerRadii: readonly number[];
    fill: SolidPaintInput | null;
    stroke: StrokeInput | null;
  }>;

/** Raw Ellipse input. */
export type EllipseNodeInput = CommonNodeInput &
  Readonly<{
    type: 'ellipse';
    width: number;
    height: number;
    fill: SolidPaintInput | null;
    stroke: StrokeInput | null;
  }>;

/** Raw Path input. */
export type PathNodeInput = CommonNodeInput &
  Readonly<{
    type: 'path';
    network: PathNetworkInput;
    fillRule: 'nonzero' | 'evenodd';
    fill: SolidPaintInput | null;
    stroke: StrokeInput | null;
  }>;

/** Raw Text input. */
export type TextNodeInput = CommonNodeInput &
  Readonly<{
    type: 'text';
    content: string;
    fontFamilies: readonly string[];
    fontWeight: number;
    fontSize: number;
    lineHeight: number;
    horizontalAlign: 'left' | 'center' | 'right';
    layoutMode: 'fixedBox' | 'autoWidth';
    width: number;
    height: number;
    fill: SolidPaintInput;
  }>;

/** Every raw schema-v1 node input. */
export type SceneNodeInput =
  | FrameNodeInput
  | GroupNodeInput
  | RectangleNodeInput
  | EllipseNodeInput
  | PathNodeInput
  | TextNodeInput;

/** Raw full-document input accepted by `validateDocument`. */
export type BringsDocumentInput = Readonly<{
  id: string;
  revision: number;
  name: string;
  pageOrder: readonly string[];
  activePageId: string;
  pages: readonly PageInput[];
  nodes: readonly SceneNodeInput[];
}>;

/** Raw input for creating a new one-page document. */
export type CreateDocumentInput = Readonly<{
  id: string;
  name: string;
  initialPage: Readonly<{
    id: string;
    name: string;
  }>;
}>;

/** Ephemeral normalized node selection for the current active page. */
export type StructuralSelection = Readonly<{
  nodeIds: readonly NodeId[];
  activeNodeId: NodeId | null;
}>;

/** Raw caller input for one ephemeral selection update. */
export type SelectionInput = Readonly<{
  nodeIds: readonly string[];
  activeNodeId: string | null;
}>;

/** Explicit mutable fields for the first Frame creation command. */
export type CreateFrameInput = Omit<FrameNodeInput, 'type' | 'parentId' | 'childIds'>;

/** Explicit mutable fields for the first Rectangle creation command. */
export type CreateRectangleInput = Omit<RectangleNodeInput, 'type' | 'parentId'>;

/** Explicit mutable fields for one Ellipse creation command. */
export type CreateEllipseInput = Omit<EllipseNodeInput, 'type' | 'parentId'>;

/** Explicit mutable fields for one Path creation command. */
export type CreatePathInput = Omit<PathNodeInput, 'type' | 'parentId'>;

/** Explicit mutable fields for one Text creation command. */
export type CreateTextInput = Omit<TextNodeInput, 'type' | 'parentId'>;

/** Raw targets and page-space affine delta for one transform intention. */
export type TransformDeltaInput = Readonly<{
  nodeIds: readonly string[];
  delta: readonly number[];
}>;

/** JSON-compatible mutable fields accepted by one atomic node property command. */
export type NodePropertyPatchInput = Readonly<{
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  width?: number;
  height?: number;
  cornerRadii?: readonly number[];
  fill?: SolidPaintInput | null;
  background?: SolidPaintInput | null;
  stroke?: StrokeInput | null;
  clipChildren?: boolean;
  content?: string;
  fontFamilies?: readonly string[];
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: number;
  horizontalAlign?: 'left' | 'center' | 'right';
  layoutMode?: 'fixedBox' | 'autoWidth';
}>;

/** Atomic property patch for one or more active-page nodes. */
export type SetNodePropertiesCommand = Readonly<{
  kind: 'set-node-properties';
  nodeIds: readonly string[];
  patch: NodePropertyPatchInput;
}>;

/** Deterministic reorder or page-geometry-preserving reparent operation. */
export type MoveNodesCommand = Readonly<{
  kind: 'move-nodes';
  nodeIds: readonly string[];
  pageId: string;
  parentId: string | null;
  index: number;
}>;

/** Create one non-visual Group around active-page sibling roots. */
export type GroupNodesCommand = Readonly<{
  kind: 'group-nodes';
  nodeIds: readonly string[];
  group: Readonly<{ id: string; name: string }>;
}>;

/** Dissolve one Group while preserving child order and page-space geometry. */
export type UngroupNodeCommand = Readonly<{
  kind: 'ungroup-node';
  nodeId: string;
}>;

/** Create one validated Path leaf in the active page. */
export type CreatePathCommand = Readonly<{
  kind: 'create-path';
  pageId: string;
  parentId: string | null;
  index: number;
  path: CreatePathInput;
}>;

/** Atomically replace the graph owned by one active, editable Path. */
export type SetPathNetworkCommand = Readonly<{
  kind: 'set-path-network';
  nodeId: string;
  network: PathNetworkInput;
}>;

/** The initial narrow command vocabulary for the document tracer. */
export type DocumentCommandInput =
  | Readonly<{ kind: 'create-page'; id: string; name: string; index: number }>
  | Readonly<{ kind: 'rename-page'; pageId: string; name: string }>
  | Readonly<{ kind: 'reorder-page'; pageId: string; index: number }>
  | Readonly<{ kind: 'delete-page'; pageId: string }>
  | Readonly<{ kind: 'activate-page'; pageId: string }>
  | Readonly<{
      kind: 'create-frame';
      pageId: string;
      parentId: string | null;
      index: number;
      frame: CreateFrameInput;
    }>
  | Readonly<{
      kind: 'create-rectangle';
      pageId: string;
      parentId: string | null;
      index: number;
      rectangle: CreateRectangleInput;
    }>
  | Readonly<{
      kind: 'create-ellipse';
      pageId: string;
      parentId: string | null;
      index: number;
      ellipse: CreateEllipseInput;
    }>
  | CreatePathCommand
  | Readonly<{
      kind: 'create-text';
      pageId: string;
      parentId: string | null;
      index: number;
      text: CreateTextInput;
    }>
  | Readonly<{
      kind: 'insert-subtree';
      pageId: string;
      parentId: string | null;
      index: number;
      rootId: string;
      nodes: readonly SceneNodeInput[];
    }>
  | Readonly<{ kind: 'apply-transform-delta' } & TransformDeltaInput>
  | Readonly<{ kind: 'delete-nodes'; nodeIds: readonly string[] }>
  | Readonly<{ kind: 'delete-node'; nodeId: string }>
  | SetNodePropertiesCommand
  | MoveNodesCommand
  | GroupNodesCommand
  | UngroupNodeCommand
  | SetPathNetworkCommand;

export { BRINGS_SCHEMA_VERSION, isOpaqueId, type OpaqueId } from './schema';
export { createDocument, validateDocument } from './document/validate';
export { resolveStructuralSelection } from './document/selection';
export { createDocumentStore } from './document/store';
export { hitTestPage, intersectPageRect, type PagePoint, type PageRect } from './geometry/hit';
export type {
  BringsDocument,
  BringsDocumentInput,
  BringsError,
  CreateFrameInput,
  CreateRectangleInput,
  CommonNode,
  CreateDocumentInput,
  DocumentCommandInput,
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
  SceneNodeInput,
  SelectionInput,
  SolidPaint,
  SolidPaintInput,
  Stroke,
  StrokeInput,
  StructuralSelection,
  TextNode,
  TransformDeltaInput,
  UUID,
} from './document/types';
export type { BringsDocumentStore, EditorSnapshot } from './document/store';

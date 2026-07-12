export { BRINGS_SCHEMA_VERSION, isOpaqueId, type OpaqueId } from './schema';
export { createDocument, validateDocument } from './document/validate';
export { createDocumentStore } from './document/store';
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
  SolidPaint,
  SolidPaintInput,
  Stroke,
  StrokeInput,
  StructuralSelection,
  TextNode,
  UUID,
} from './document/types';
export type { BringsDocumentStore, EditorSnapshot } from './document/store';

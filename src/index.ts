export { BRINGS_SCHEMA_VERSION, isOpaqueId, type OpaqueId } from './schema';
export { createDocument, validateDocument } from './document/validate';
export { resolveStructuralSelection } from './document/selection';
export { createDocumentStore } from './document/store';
export { hitTestPage, intersectPageRect, type PagePoint, type PageRect } from './geometry/hit';
export { createPageHitIndex, type PageHitIndex } from './geometry/pageHitIndex';
export {
  ALIGNMENT_SNAP_THRESHOLD,
  prepareSelectionAlignment,
  type AlignmentAnchor,
  type AlignmentAxis,
  type AlignmentGuide,
  type AlignmentMoveResult,
  type AlignmentResizeResult,
  type PreparedSelectionAlignment,
} from './geometry/alignment';
export {
  prepareSelectionResize,
  type PreparedSelectionResize,
  type ResizeBounds,
  type ResizeHandle,
  type ResizeHandlePosition,
  type ResizePoint,
  type SelectionResizeCommand,
  type SelectionResizeProposal,
  type SelectionResizeProposalInput,
} from './geometry/resize';
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
  GroupNodesCommand,
  GroupNode,
  Matrix,
  MoveNodesCommand,
  NodeId,
  NodePropertyPatchInput,
  Page,
  PageId,
  Radii,
  RectangleNode,
  Result,
  SceneNode,
  SceneNodeInput,
  SelectionInput,
  SetNodePropertiesCommand,
  SolidPaint,
  SolidPaintInput,
  Stroke,
  StrokeInput,
  StructuralSelection,
  TextNode,
  TransformDeltaInput,
  UngroupNodeCommand,
  UUID,
} from './document/types';
export type { BringsDocumentStore, EditorSnapshot } from './document/store';

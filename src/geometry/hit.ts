import type { BringsDocument, Matrix, NodeId, Result, SceneNode } from '../document/types';
import {
  boundsIntersect,
  clipConvexPolygon,
  ellipseIntersectsPolygon,
  localStrokeExpansion,
  polygonBounds,
  polygonsIntersect,
  rectanglePolygon,
  transformPolygon,
  type Polygon,
} from './intersection';
import { invertMatrix, MIN_MATRIX_DETERMINANT, multiplyMatrices } from './matrix';

export type PagePoint = Readonly<{ x: number; y: number }>;

export type PageRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type NormalizedRect = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

type NodeEntry = Readonly<{ node: SceneNode; index: number }>;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function nodeTransformPath(nodeIndex: number): string {
  return `/nodes/${nodeIndex}/transform`;
}

function normalizeRect(rect: PageRect): Result<NormalizedRect> {
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(rect[field])) {
      return failure('geometry.rect-invalid', `/rect/${field}`);
    }
  }

  const endX = rect.x + rect.width;
  const endY = rect.y + rect.height;
  if (!Number.isFinite(endX)) return failure('geometry.rect-overflow', '/rect/width');
  if (!Number.isFinite(endY)) return failure('geometry.rect-overflow', '/rect/height');
  return success({
    minX: Math.min(rect.x, endX),
    minY: Math.min(rect.y, endY),
    maxX: Math.max(rect.x, endX),
    maxY: Math.max(rect.y, endY),
  });
}

function transformedRectangle(
  matrix: Matrix,
  x: number,
  y: number,
  width: number,
  height: number,
  path: string,
): Result<Polygon> {
  return transformPolygon(matrix, rectanglePolygon(x, y, width, height), path);
}

function broadPhaseIntersects(candidate: Polygon, query: Polygon): boolean {
  const candidateBounds = polygonBounds(candidate);
  const queryBounds = polygonBounds(query);
  return (
    candidateBounds !== null &&
    queryBounds !== null &&
    boundsIntersect(candidateBounds, queryBounds)
  );
}

function rectangleLikeIntersects(
  node: Extract<SceneNode, { type: 'frame' | 'rectangle' }>,
  pageMatrix: Matrix,
  query: Polygon,
  path: string,
): Result<boolean> {
  const expansion = localStrokeExpansion(node.stroke?.width ?? null);
  const candidate = transformedRectangle(
    pageMatrix,
    -expansion,
    -expansion,
    node.width + expansion * 2,
    node.height + expansion * 2,
    path,
  );
  if (!candidate.ok) return candidate;
  if (!broadPhaseIntersects(candidate.value, query)) return success(false);
  return polygonsIntersect(candidate.value, query, path);
}

function textIntersects(
  node: Extract<SceneNode, { type: 'text' }>,
  pageMatrix: Matrix,
  query: Polygon,
  path: string,
): Result<boolean> {
  const candidate = transformedRectangle(pageMatrix, 0, 0, node.width, node.height, path);
  if (!candidate.ok) return candidate;
  if (!broadPhaseIntersects(candidate.value, query)) return success(false);
  return polygonsIntersect(candidate.value, query, path);
}

function ellipseIntersects(
  node: Extract<SceneNode, { type: 'ellipse' }>,
  pageMatrix: Matrix,
  query: Polygon,
  path: string,
): Result<boolean> {
  const expansion = localStrokeExpansion(node.stroke?.width ?? null);
  const candidateBounds = transformedRectangle(
    pageMatrix,
    -expansion,
    -expansion,
    node.width + expansion * 2,
    node.height + expansion * 2,
    path,
  );
  if (!candidateBounds.ok) return candidateBounds;
  if (!broadPhaseIntersects(candidateBounds.value, query)) return success(false);

  const inverse = invertMatrix(pageMatrix, path);
  if (!inverse.ok) {
    if (inverse.error.code === 'matrix.singular') return success(false);
    return failure('geometry.computation-overflow', path);
  }
  const localQuery = transformPolygon(inverse.value, query, path);
  if (!localQuery.ok) return localQuery;
  return ellipseIntersectsPolygon(localQuery.value, node.width, node.height, expansion, path);
}

function candidateIntersects(
  node: SceneNode,
  pageMatrix: Matrix,
  query: Polygon,
  nodeIndex: number,
): Result<boolean> {
  const path = nodeTransformPath(nodeIndex);
  switch (node.type) {
    case 'frame':
    case 'rectangle':
      return rectangleLikeIntersects(node, pageMatrix, query, path);
    case 'ellipse':
      return ellipseIntersects(node, pageMatrix, query, path);
    case 'text':
      return textIntersects(node, pageMatrix, query, path);
    case 'group':
      return success(false);
  }
}

function queryPagePolygon(document: BringsDocument, query: Polygon): Result<readonly NodeId[]> {
  const pageIndex = document.pages.findIndex((page) => page.id === document.activePageId);
  if (pageIndex < 0) {
    return failure('geometry.active-page-not-found', '/activePageId');
  }

  const nodes = new Map<string, NodeEntry>(
    document.nodes.map((node, index) => [node.id, { node, index }] as const),
  );
  const hits: NodeId[] = [];

  const visit = (
    node: SceneNode,
    nodeIndex: number,
    parentMatrix: Matrix,
    clippedQuery: Polygon,
  ): Result<void> => {
    if (!node.visible || node.locked || clippedQuery.length === 0) {
      return success(undefined);
    }

    const path = nodeTransformPath(nodeIndex);
    const pageMatrix = multiplyMatrices(parentMatrix, node.transform);
    if (pageMatrix.some((value) => !Number.isFinite(value))) {
      return failure('geometry.computation-overflow', path);
    }
    const determinant = pageMatrix[0] * pageMatrix[3] - pageMatrix[1] * pageMatrix[2];
    if (!Number.isFinite(determinant)) {
      return failure('geometry.computation-overflow', path);
    }
    if (Math.abs(determinant) < MIN_MATRIX_DETERMINANT) {
      return success(undefined);
    }

    const candidate = candidateIntersects(node, pageMatrix, clippedQuery, nodeIndex);
    if (!candidate.ok) return candidate;
    if (candidate.value) hits.push(node.id);

    if (node.type !== 'frame' && node.type !== 'group') {
      return success(undefined);
    }

    let childQuery = clippedQuery;
    if (node.type === 'frame' && node.clipChildren) {
      const clip = transformedRectangle(pageMatrix, 0, 0, node.width, node.height, path);
      if (!clip.ok) return clip;
      const clipped = clipConvexPolygon(clippedQuery, clip.value, path);
      if (!clipped.ok) return clipped;
      childQuery = clipped.value;
    }

    for (let childIndex = 0; childIndex < node.childIds.length; childIndex += 1) {
      const childId = node.childIds[childIndex]!;
      const entry = nodes.get(childId);
      if (entry === undefined) {
        return failure('geometry.document-invariant', `/nodes/${nodeIndex}/childIds/${childIndex}`);
      }
      if (entry.node.parentId !== node.id) {
        return failure('geometry.document-invariant', `/nodes/${entry.index}/parentId`);
      }
      const child = visit(entry.node, entry.index, pageMatrix, childQuery);
      if (!child.ok) return child;
    }
    return success(undefined);
  };

  const page = document.pages[pageIndex]!;
  for (let rootIndex = 0; rootIndex < page.rootNodeIds.length; rootIndex += 1) {
    const rootId = page.rootNodeIds[rootIndex]!;
    const root = nodes.get(rootId);
    if (root === undefined) {
      return failure('geometry.document-invariant', `/pages/${pageIndex}/rootNodeIds/${rootIndex}`);
    }
    if (root.node.parentId !== null) {
      return failure('geometry.document-invariant', `/nodes/${root.index}/parentId`);
    }
    const result = visit(root.node, root.index, IDENTITY, query);
    if (!result.ok) return result;
  }
  return success(hits);
}

/** Return eligible node IDs in stable back-to-front order for one page-space rectangle. */
export function intersectPageRect(
  document: BringsDocument,
  rect: PageRect,
): Result<readonly NodeId[]> {
  const normalized = normalizeRect(rect);
  if (!normalized.ok) return normalized;
  const value = normalized.value;
  return queryPagePolygon(
    document,
    rectanglePolygon(value.minX, value.minY, value.maxX - value.minX, value.maxY - value.minY),
  );
}

/** Return eligible node IDs in front-to-back order for one page-space point. */
export function hitTestPage(document: BringsDocument, point: PagePoint): readonly NodeId[] {
  const result = intersectPageRect(document, {
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
  });
  return result.ok ? [...result.value].reverse() : [];
}

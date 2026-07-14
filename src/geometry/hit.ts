import type { BringsDocument, Matrix, NodeId, Result, SceneNode } from '../document/types';
import {
  clipConvexPolygon,
  rectanglePolygon,
  transformPolygon,
  type Polygon,
} from './intersection';
import {
  normalizedPageRectPolygon,
  normalizePageRect,
  prepareSelectionCandidate,
  preparedCandidateIntersects,
} from './hitShared';
import { MIN_MATRIX_DETERMINANT, multiplyMatrices } from './matrix';

export type PagePoint = Readonly<{ x: number; y: number }>;

export type PageRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
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

function candidateIntersects(
  node: SceneNode,
  pageMatrix: Matrix,
  query: Polygon,
  nodeIndex: number,
): Result<boolean> {
  const prepared = prepareSelectionCandidate(node, pageMatrix, nodeIndex);
  if (!prepared.ok) return prepared;
  if (prepared.value === null) return success(false);
  return preparedCandidateIntersects(prepared.value, query);
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
  const normalized = normalizePageRect(rect);
  if (!normalized.ok) return normalized;
  return queryPagePolygon(document, normalizedPageRectPolygon(normalized.value));
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

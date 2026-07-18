import type { Matrix, NodeId, Result, SceneNode } from '../document/types';
import {
  boundsIntersect,
  ellipseIntersectsPolygon,
  localStrokeExpansion,
  polygonBounds,
  polygonsIntersect,
  rectanglePolygon,
  transformPolygon,
  type Bounds,
  type Polygon,
} from './intersection';
import type { PageRect } from './hit';
import { invertMatrix } from './matrix';
import {
  flattenPathNetwork,
  flattenedPathIntersectsPolygon,
  pathNetworkBounds,
  type FlattenedPathComponent,
} from './path';

export type NormalizedPageRect = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

type SelectableNode = Exclude<SceneNode, { type: 'group' } | { type: 'path' }>;

type PreparedPolygonSilhouette = Readonly<{
  kind: 'polygon';
  pagePolygon: Polygon;
}>;

type PreparedEllipseSilhouette = Readonly<{
  kind: 'ellipse';
  pageMatrix: Matrix;
  width: number;
  height: number;
  localStrokeExpansion: number;
}>;

type PreparedPathSilhouette = Readonly<{
  kind: 'path';
  pageMatrix: Matrix;
  components: readonly FlattenedPathComponent[];
  fillRule: 'nonzero' | 'evenodd';
  hasFill: boolean;
  hasStroke: boolean;
  strokeExpansion: number;
}>;

export type PreparedSelectionCandidate = Readonly<{
  id: NodeId;
  nodeIndex: number;
  pageBounds: Bounds;
  path: string;
  silhouette: PreparedPolygonSilhouette | PreparedEllipseSilhouette | PreparedPathSilhouette;
}>;

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function nodeTransformPath(nodeIndex: number): string {
  return `/nodes/${nodeIndex}/transform`;
}

function freezeMatrix(matrix: Matrix): Matrix {
  return Object.freeze([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4],
    matrix[5],
  ]) as Matrix;
}

function freezeBounds(bounds: Bounds): Bounds {
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function freezePolygon(polygon: Polygon): Polygon {
  return Object.freeze(polygon.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

export function normalizePageRect(rect: PageRect): Result<NormalizedPageRect> {
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

export function normalizedPageRectPolygon(rect: NormalizedPageRect): Polygon {
  return rectanglePolygon(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
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

function selectablePolygon(
  node: SelectableNode,
  pageMatrix: Matrix,
  path: string,
): Result<Polygon> {
  switch (node.type) {
    case 'frame':
    case 'rectangle': {
      const expansion = localStrokeExpansion(node.stroke?.width ?? null);
      return transformedRectangle(
        pageMatrix,
        -expansion,
        -expansion,
        node.width + expansion * 2,
        node.height + expansion * 2,
        path,
      );
    }
    case 'ellipse': {
      const expansion = localStrokeExpansion(node.stroke?.width ?? null);
      return transformedRectangle(
        pageMatrix,
        -expansion,
        -expansion,
        node.width + expansion * 2,
        node.height + expansion * 2,
        path,
      );
    }
    case 'text':
      return transformedRectangle(pageMatrix, 0, 0, node.width, node.height, path);
  }
}

export function prepareSelectionCandidate(
  node: SceneNode,
  pageMatrix: Matrix,
  nodeIndex: number,
): Result<PreparedSelectionCandidate | null> {
  if (node.type === 'group') return success(null);

  const path = nodeTransformPath(nodeIndex);
  if (node.type === 'path') {
    const rawBounds = pathNetworkBounds(node.network, pageMatrix, path);
    if (!rawBounds.ok) return rawBounds;
    const strokeExpansion = localStrokeExpansion(node.stroke?.width ?? null);
    const expansionX = strokeExpansion * Math.hypot(pageMatrix[0], pageMatrix[2]);
    const expansionY = strokeExpansion * Math.hypot(pageMatrix[1], pageMatrix[3]);
    if (!Number.isFinite(expansionX) || !Number.isFinite(expansionY)) {
      return failure('geometry.computation-overflow', path);
    }
    const scale = Math.max(
      Math.hypot(pageMatrix[0], pageMatrix[1]),
      Math.hypot(pageMatrix[2], pageMatrix[3]),
    );
    if (!Number.isFinite(scale) || scale <= 0)
      return failure('geometry.computation-overflow', path);
    const flattened = flattenPathNetwork(node.network, 0.25 / scale, path);
    if (!flattened.ok) return flattened;
    const expandedBounds = {
      minX: rawBounds.value.minX - expansionX,
      minY: rawBounds.value.minY - expansionY,
      maxX: rawBounds.value.maxX + expansionX,
      maxY: rawBounds.value.maxY + expansionY,
    };
    if (Object.values(expandedBounds).some((value) => !Number.isFinite(value))) {
      return failure('geometry.computation-overflow', path);
    }
    const pageBounds = freezeBounds(expandedBounds);
    const silhouette: PreparedPathSilhouette = Object.freeze({
      kind: 'path',
      pageMatrix: freezeMatrix(pageMatrix),
      components: flattened.value,
      fillRule: node.fillRule,
      hasFill: node.fill !== null,
      hasStroke: node.stroke !== null,
      strokeExpansion,
    });
    return success(Object.freeze({ id: node.id, nodeIndex, pageBounds, path, silhouette }));
  }
  const silhouette = selectablePolygon(node, pageMatrix, path);
  if (!silhouette.ok) return silhouette;
  const pageBounds = polygonBounds(silhouette.value);
  if (pageBounds === null) return failure('geometry.computation-overflow', path);

  const preparedSilhouette: PreparedPolygonSilhouette | PreparedEllipseSilhouette =
    node.type === 'ellipse'
      ? Object.freeze({
          kind: 'ellipse',
          pageMatrix: freezeMatrix(pageMatrix),
          width: node.width,
          height: node.height,
          localStrokeExpansion: localStrokeExpansion(node.stroke?.width ?? null),
        })
      : Object.freeze({ kind: 'polygon', pagePolygon: freezePolygon(silhouette.value) });

  return success(
    Object.freeze({
      id: node.id,
      nodeIndex,
      pageBounds: freezeBounds(pageBounds),
      path,
      silhouette: preparedSilhouette,
    }),
  );
}

export function preparedCandidateIntersects(
  candidate: PreparedSelectionCandidate,
  query: Polygon,
): Result<boolean> {
  const queryBounds = polygonBounds(query);
  if (queryBounds === null || !boundsIntersect(candidate.pageBounds, queryBounds)) {
    return success(false);
  }

  if (candidate.silhouette.kind === 'polygon') {
    return polygonsIntersect(candidate.silhouette.pagePolygon, query, candidate.path);
  }

  if (candidate.silhouette.kind === 'path') {
    const inverse = invertMatrix(candidate.silhouette.pageMatrix, candidate.path);
    if (!inverse.ok) {
      if (inverse.error.code === 'matrix.singular') return success(false);
      return failure('geometry.computation-overflow', candidate.path);
    }
    const localQuery = transformPolygon(inverse.value, query, candidate.path);
    if (!localQuery.ok) return localQuery;
    return flattenedPathIntersectsPolygon(
      candidate.silhouette.components,
      localQuery.value,
      {
        fillRule: candidate.silhouette.fillRule,
        hasFill: candidate.silhouette.hasFill,
        hasStroke: candidate.silhouette.hasStroke,
        strokeExpansion: candidate.silhouette.strokeExpansion,
      },
      candidate.path,
    );
  }

  const inverse = invertMatrix(candidate.silhouette.pageMatrix, candidate.path);
  if (!inverse.ok) {
    if (inverse.error.code === 'matrix.singular') return success(false);
    return failure('geometry.computation-overflow', candidate.path);
  }
  const localQuery = transformPolygon(inverse.value, query, candidate.path);
  if (!localQuery.ok) return localQuery;
  return ellipseIntersectsPolygon(
    localQuery.value,
    candidate.silhouette.width,
    candidate.silhouette.height,
    candidate.silhouette.localStrokeExpansion,
    candidate.path,
  );
}

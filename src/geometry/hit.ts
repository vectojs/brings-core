import type { BringsDocument, Matrix, NodeId, SceneNode, SolidPaint } from '../document/types';

export type PagePoint = Readonly<{ x: number; y: number }>;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function localPoint(matrix: Matrix, point: PagePoint): PagePoint | null {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const x = point.x - matrix[4];
  const y = point.y - matrix[5];
  return {
    x: (matrix[3] * x - matrix[2] * y) / determinant,
    y: (-matrix[1] * x + matrix[0] * y) / determinant,
  };
}

function containsRectangle(point: PagePoint | null, width: number, height: number): boolean {
  return point !== null && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

function paints(paint: SolidPaint | null, opacity: number): boolean {
  return paint !== null && paint.a > 0 && opacity > 0;
}

/** Return eligible node IDs in front-to-back order for one page-space point. */
export function hitTestPage(document: BringsDocument, point: PagePoint): readonly NodeId[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
  const activePage = document.pages.find((page) => page.id === document.activePageId);
  if (activePage === undefined) return [];
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const hits: NodeId[] = [];

  const visit = (node: SceneNode, parentMatrix: Matrix): void => {
    if (!node.visible || node.locked) return;
    const pageMatrix = multiply(parentMatrix, node.transform);
    const local = localPoint(pageMatrix, point);
    if (node.type === 'frame' || node.type === 'group') {
      const mayVisitChildren =
        node.type !== 'frame' ||
        !node.clipChildren ||
        containsRectangle(local, node.width, node.height);
      if (mayVisitChildren) {
        for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
          const child = nodes.get(node.childIds[index]!);
          if (child !== undefined) visit(child, pageMatrix);
        }
      }
    }
    if (
      node.type === 'frame' &&
      paints(node.background, node.opacity) &&
      containsRectangle(local, node.width, node.height)
    ) {
      hits.push(node.id);
    }
    if (
      node.type === 'rectangle' &&
      paints(node.fill, node.opacity) &&
      containsRectangle(local, node.width, node.height)
    ) {
      hits.push(node.id);
    }
  };

  for (let index = activePage.rootNodeIds.length - 1; index >= 0; index -= 1) {
    const root = nodes.get(activePage.rootNodeIds[index]!);
    if (root !== undefined) visit(root, IDENTITY);
  }
  return hits;
}

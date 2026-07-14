import type { BringsDocument, Matrix, Result } from '../document/types';

/** Smallest absolute determinant accepted by Brings affine geometry. */
export const MIN_MATRIX_DETERMINANT = 1e-12;

function failure(code: string, path: string): Result<never> {
  return { ok: false, error: { code, path } };
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Compose two affine matrices for column vectors (`left * right`). */
export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

/** Invert one finite, non-singular affine matrix. */
export function invertMatrix(matrix: Matrix, path: string): Result<Matrix> {
  if (matrix.some((value) => !Number.isFinite(value))) return failure('matrix.invalid', path);
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant)) return failure('matrix.computation-overflow', path);
  if (Math.abs(determinant) < MIN_MATRIX_DETERMINANT) {
    return failure('matrix.singular', path);
  }
  const inverse: Matrix = [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ];
  return inverse.every(Number.isFinite)
    ? success(inverse)
    : failure('matrix.computation-overflow', path);
}

/** Derive one node's immutable page-space matrix from validated document state. */
export function pageMatrixForNode(
  document: BringsDocument,
  nodeId: string,
  path: string,
): Result<Matrix> {
  const nodes = new Map(document.nodes.map((node) => [node.id as string, node]));
  let current = nodes.get(nodeId);
  if (current === undefined) return failure('node.not-found', path);

  const chain = [current];
  while (current.parentId !== null) {
    current = nodes.get(current.parentId);
    if (current === undefined) return failure('node.parent-not-found', path);
    chain.push(current);
  }

  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    matrix = multiplyMatrices(matrix, chain[index]!.transform);
  }
  return success(matrix);
}

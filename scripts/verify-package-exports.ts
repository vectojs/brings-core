import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type PackageExports = {
  readonly '.': {
    readonly types: string;
    readonly import: string;
    readonly require: string;
  };
};

type PackageMetadata = {
  readonly main: string;
  readonly module: string;
  readonly types: string;
  readonly exports: PackageExports;
};

const packageMetadata = (await Bun.file('package.json').json()) as PackageMetadata;
const entryPaths = [
  packageMetadata.main,
  packageMetadata.module,
  packageMetadata.types,
  packageMetadata.exports['.'].types,
  packageMetadata.exports['.'].import,
  packageMetadata.exports['.'].require,
];

for (const entryPath of entryPaths) {
  const normalizedPath = entryPath.replace(/^\.\//, '');
  if (!(await Bun.file(normalizedPath).exists())) {
    throw new Error(`Declared package entry does not exist: ${entryPath}`);
  }
}

const esmEntry = packageMetadata.exports['.'].import.replace(/^\.\//, '../');
const packageExports = await import(new URL(esmEntry, import.meta.url).href);

if (typeof packageExports.createDocumentStore !== 'function') {
  throw new Error('The ESM package entry does not export createDocumentStore.');
}

if (typeof packageExports.createPageHitIndex !== 'function') {
  throw new Error('The ESM package entry does not export createPageHitIndex.');
}

for (const internalName of [
  'DEFAULT_PAGE_HIT_INDEX_LIMITS',
  'createPageHitIndexForTesting',
  'inspectPageHitIndex',
]) {
  if (internalName in packageExports) {
    throw new Error(`The ESM package entry exposes source-only ${internalName}.`);
  }
}

const require = createRequire(import.meta.url);
const cjsEntry = packageMetadata.exports['.'].require.replace(/^\.\//, '../');
const cjsExports = require(fileURLToPath(new URL(cjsEntry, import.meta.url))) as Record<
  string,
  unknown
>;
if (typeof cjsExports.createPageHitIndex !== 'function') {
  throw new Error('The CommonJS package entry does not export createPageHitIndex.');
}

for (const internalName of [
  'DEFAULT_PAGE_HIT_INDEX_LIMITS',
  'createPageHitIndexForTesting',
  'inspectPageHitIndex',
]) {
  if (internalName in cjsExports) {
    throw new Error(`The CommonJS package entry exposes source-only ${internalName}.`);
  }
}

const declarations = await readFile(packageMetadata.types.replace(/^\.\//, ''), 'utf8');
for (const name of ['PageHitIndex', 'createPageHitIndex']) {
  if (!declarations.includes(name)) {
    throw new Error(`Generated declarations omit ${name}.`);
  }
}

for (const internalName of [
  'PageHitQueryMetrics',
  'DEFAULT_PAGE_HIT_INDEX_LIMITS',
  'createPageHitIndexForTesting',
  'inspectPageHitIndex',
]) {
  if (declarations.includes(internalName)) {
    throw new Error(`Generated package-root declarations expose source-only ${internalName}.`);
  }
}

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

/** Stable interchange-format version for the first Brings document schema. */
export const BRINGS_SCHEMA_VERSION = 1 as const;

/** An opaque document identifier whose allocation policy belongs to the caller. */
export type OpaqueId = string & { readonly __brand: 'BringsOpaqueId' };

/** Reject missing identifiers without prescribing a browser or UUID implementation. */
export function isOpaqueId(value: string): value is OpaqueId {
  return value.length > 0;
}

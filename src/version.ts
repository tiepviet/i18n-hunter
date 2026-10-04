declare const __PACKAGE_VERSION__: string | undefined

// Fallback when the tsup `define` for __PACKAGE_VERSION__ is unavailable
// (e.g. vitest, tsx). TODO: derive from package.json via createRequire at
// runtime instead of hardcoding. Keep FALLBACK_VERSION in sync with the
// `version` field in package.json — bump them together.
export const FALLBACK_VERSION = '0.2.0'

export function packageVersion(): string {
  return typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : FALLBACK_VERSION
}

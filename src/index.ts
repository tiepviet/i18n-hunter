export type {
  CategorizedResults,
  ComponentContext,
  Diagnostic,
  DiagnosticSeverity,
  ExtractedCandidate,
  ExtractionReport,
  FindingCategory,
  NotificationType,
  ParseResult,
  ParsedVueBlock,
  ParsedVueComponent,
  ScanLimits,
  ScanResult,
  ScannerConfig,
  SourceRange,
  TransformKind,
} from './types.js'
export { findingCategories, transformKinds } from './types.js'

export { createScannerConfig, defaultScannerConfig } from './config.js'
export { HunterError } from './errors.js'
export {
  canonicalizeRoot,
  isPathInside,
  resolveContainedPath,
  resolveContainedSourcePath,
  sourceExtensions,
  validatePortableRelativePath,
} from './path-policy.js'
export { defaultScanLimits, resolveScanLimits } from './limits.js'
export { discoverSourceFiles } from './discovery.js'
export type { DiscoveryOptions, DiscoveryResult } from './discovery.js'
export { matchesPattern, findFiles, getAllFiles } from './file-utils.js'
export { generateSmartKey } from './key-generator.js'
export { hashText, positionAt } from './source-range.js'

export { ExtractionReportSchema, DiagnosticSchema, parseExtractionReport } from './report-schema.js'
export { ManifestSchema, parseManifest } from './manifest-schema.js'
export { readJsonBounded } from './safe-json.js'

export { parseReactSource, parseReactComponent } from './react-parser.js'
export { parseVueSource, parseVueComponent, extractTemplateStrings } from './vue-parser.js'
export { scanForHardcodedStrings } from './scanner.js'
export { createFileTransformPlan } from './transform.js'
export type { TransformPlan } from './transform.js'
export { applyReport, rollbackTransactions, cleanTransactions } from './applier.js'
export type { ApplyOptions, ApplyResult, RollbackResult, CleanResult } from './applier.js'
export { syncReportMd } from './sync-report.js'
export type { SyncResult } from './sync-report.js'
export {
  categorizeFindings,
  exportReport,
  generateJsonReport,
  generateMarkdownReport,
  generateSummary,
} from './report-formatter.js'
export type { ExportOptions } from './report-formatter.js'

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
export { HunterError, errorMessage, safeMessage } from './errors.js'
export type { HunterErrorCode } from './errors.js'
export {
  canonicalizeRoot,
  isJsxSourcePath,
  isPathInside,
  isTypeScriptSourcePath,
  isVueSourcePath,
  resolveContainedPath,
  resolveContainedSourcePath,
  sourceExtensions,
  validatePortableRelativePath,
} from './path-policy.js'
export { defaultScanLimits, resolveScanLimits, scanLimitCeilings } from './limits.js'
export { discoverSourceFiles } from './discovery.js'
export type { DiscoveryOptions, DiscoveryResult } from './discovery.js'
export { matchesPattern, findFiles, getAllFiles } from './file-utils.js'
export { generateSmartKey } from './key-generator.js'
export { hashText, positionAt } from './source-range.js'

export { ExtractionReportSchema, DiagnosticSchema, parseExtractionReport } from './report-schema.js'
export { ManifestSchema, LatestTransactionSchema, parseManifest } from './manifest-schema.js'
export { readJsonBounded, defaultMaxJsonBytes } from './safe-json.js'
export { packageVersion } from './version.js'
export { parseCliArgs } from './cli-args.js'
export type { ParsedCliArgs, CommandName } from './cli-args.js'
export { runCli } from './cli-runner.js'
export type { CliIo } from './cli-runner.js'
export {
  categoryForContext,
  categoryForTag,
  isTechnicalValue,
  isVisibleText,
  normalizeAttributeName,
} from './i18n-taxonomy.js'

export { parseReactSource, parseReactComponent } from './react-parser.js'
export { parseVueSource, parseVueComponent, extractTemplateStrings } from './vue-parser.js'
export { scanForHardcodedStrings, scanFileFingerprint, scanBasePath } from './scanner.js'
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

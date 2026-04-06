/**
 * i18n-hunter
 *
 * Universal scanner for hardcoded strings in Vue and React projects.
 *
 * @module i18n-hunter
 * @license MIT
 */

// ── Types ──────────────────────────────────────
export type {
  ScanResult,
  CategorizedResults,
  ExtractionReport,
  ScannerConfig,
  ParsedVueComponent,
} from './types.js'

// ── Configuration ──────────────────────────────
export { defaultScannerConfig, exclusionPatterns, categorizationPatterns } from './config.js'

// ── File utilities ─────────────────────────────
export { matchesPattern, findFiles, readFile, getAllFiles } from './file-utils.js'

// ── Vue parser (@vue/compiler-dom AST) ─────────
export { parseVueComponent, extractTemplateStrings, extractScriptStrings } from './vue-parser.js'

// ── React parser (@babel/parser AST) ──────────
export type { ExtractedString } from './react-parser.js'
export { parseReactComponent } from './react-parser.js'

// ── Main scanner (orchestrator) ────────────────
export { scanForHardcodedStrings } from './scanner.js'

// ── Apply / Rollback ──────────────────────────
export { applyReport, rollbackFromManifest, cleanBackups } from './applier.js'
export type { ApplyOptions, ApplyResult } from './applier.js'

// ── Sync ─────────────────────────────────────
export { syncReportMd } from './sync-report.js'
export type { SyncResult } from './sync-report.js'

// ── Reporting ──────────────────────────────────
export {
  generateMarkdownReport,
  generateJsonReport,
  exportReport,
  generateSummary,
} from './report-formatter.js'
export type { ExportOptions } from './report-formatter.js'

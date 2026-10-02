export const findingCategories = ['label', 'button', 'message', 'error', 'notification'] as const

export type FindingCategory = (typeof findingCategories)[number]

export const transformKinds = [
  'vue-template-text',
  'vue-template-attribute',
  'react-jsx-text',
  'react-jsx-attribute',
  'react-expression-string',
  'script-string',
  'script-template',
] as const

export type TransformKind = (typeof transformKinds)[number]
export type DiagnosticSeverity = 'error' | 'warning' | 'info'
export type NotificationType = 'success' | 'error' | 'info' | 'warning'

export interface SourceRange {
  /** UTF-16 offset, inclusive. */
  start: number
  /** UTF-16 offset, exclusive. */
  end: number
}

export interface ComponentContext {
  id: string
  name: string
  start: number
  end: number
  bodyStart: number
  expressionBody?: boolean
  expressionStart?: number
  expressionEnd?: number
  kind: 'react-function' | 'vue-script-setup' | 'vue-options'
}

export interface Diagnostic {
  severity: DiagnosticSeverity
  code: string
  message: string
  filePath?: string
  lineNumber?: number
  columnNumber?: number
}

export interface ExtractedCandidate {
  value: string
  raw: string
  range: SourceRange
  lineNumber: number
  columnNumber: number
  endLineNumber: number
  endColumnNumber: number
  suggestedKey?: string
  context: string
  category: FindingCategory
  transform: TransformKind
  component?: ComponentContext
  isNotification?: boolean
  notificationType?: NotificationType
}

export interface ParseResult {
  candidates: ExtractedCandidate[]
  diagnostics: Diagnostic[]
}

export interface ScanResult {
  id: string
  filePath: string
  fileSha256: string
  sliceSha256: string
  valueSha256?: string
  /** Omitted when the report is redacted. The range and hash remain sufficient to apply. */
  hardcodedString?: string
  lineNumber: number
  columnNumber: number
  endLineNumber: number
  endColumnNumber: number
  suggestedKey: string
  context: string
  category: FindingCategory
  transform: TransformKind
  range: SourceRange
  component?: ComponentContext
  isNotification?: boolean
  notificationType?: NotificationType
}

export interface CategorizedResults {
  labels: ScanResult[]
  buttons: ScanResult[]
  messages: ScanResult[]
  errors: ScanResult[]
  notifications: ScanResult[]
}

export interface ScanLimits {
  maxFileBytes: number
  maxFiles: number
  maxTotalBytes: number
  maxFindings: number
  maxDepth: number
}

export interface ExtractionReport {
  schemaVersion: 2
  generatedAt: string
  complete: boolean
  scan: {
    paths: string[]
    includePatterns: string[]
    excludePatterns: string[]
    limits: ScanLimits
  }
  summary: {
    filesDiscovered: number
    filesScanned: number
    findings: number
    categories: Record<FindingCategory, number>
    diagnostics: Record<DiagnosticSeverity, number>
  }
  findings: ScanResult[]
  diagnostics: Diagnostic[]
}

export interface ParsedVueBlock {
  content: string
  start: number
  end: number
  lang?: string
  setup: boolean
}

export interface ParsedVueComponent {
  filePath: string
  template?: ParsedVueBlock
  script?: ParsedVueBlock
  scriptSetup?: ParsedVueBlock
  errors: string[]
}

export interface ScannerConfig {
  scanPaths: string[]
  includePatterns: string[]
  excludePatterns: string[]
  limits?: Partial<ScanLimits>
  includeValues?: boolean
  readableKeys?: boolean
  /** Managed state directory that must never be scanned as source. */
  stateDir?: string
}

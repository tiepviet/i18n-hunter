/**
 * i18n-hunter Types
 */

export interface ScanResult {
  filePath: string
  lineNumber: number
  columnNumber: number
  hardcodedString: string
  suggestedKey: string
  context: string
  category?: string
  isNotification?: boolean
  notificationType?: 'success' | 'error' | 'info' | 'warning'
}

export interface CategorizedResults {
  labels: ScanResult[]
  buttons: ScanResult[]
  messages: ScanResult[]
  errors: ScanResult[]
  notifications: ScanResult[]
}

export interface ExtractionReport {
  totalFiles: number
  totalStrings: number
  results: ScanResult[]
  categorizedResults: CategorizedResults
}

export interface ParsedVueComponent {
  filePath: string
  template?: {
    content: string
    loc: {
      start: { line: number; column: number }
      end: { line: number; column: number }
    }
  }
  script?: {
    content: string
    loc: {
      start: { line: number; column: number }
      end: { line: number; column: number }
    }
  }
  scriptSetup?: {
    content: string
    loc: {
      start: { line: number; column: number }
      end: { line: number; column: number }
    }
  }
}

export interface ScannerConfig {
  scanPaths: string[]
  includePatterns: string[]
  excludePatterns: string[]
}

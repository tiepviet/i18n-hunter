import { join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { defaultScannerConfig, categorizationPatterns } from './config.js'
import { getAllFiles } from './file-utils.js'
import {
  parseVueComponent,
  extractTemplateStrings,
  extractScriptStrings,
} from './vue-parser.js'
import { parseReactComponent } from './react-parser.js'
import type { 
  ScannerConfig, 
  ScanResult, 
  ExtractionReport, 
  CategorizedResults 
} from './types.js'

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Main entry point for scanning hardcoded strings.
 */
export function scanForHardcodedStrings(
  userConfig: Partial<ScannerConfig> = {},
  basePath: string = process.cwd(),
): ExtractionReport {
  const config = { ...defaultScannerConfig, ...userConfig }
  
  const allFiles = getAllFiles(
    config.scanPaths,
    config.includePatterns,
    config.excludePatterns,
    basePath,
  )

  console.log(`[i18n-hunter] Hunting in ${allFiles.length} files…`)

  const results: ScanResult[] = []
  for (const filePath of allFiles) {
    if (filePath.endsWith('.vue')) {
      results.push(...scanVueFile(filePath, basePath))
    } else {
      results.push(...scanScriptFile(filePath, basePath))
    }
  }

  const report: ExtractionReport = {
    totalFiles: allFiles.length,
    totalStrings: results.length,
    results,
    categorizedResults: categorizeResults(results),
  }

  return report
}

// ─────────────────────────────────────────────
// Internal scanning logic
// ─────────────────────────────────────────────

/**
 * Scan a single Vue SFC.
 */
function scanVueFile(filePath: string, basePath: string): ScanResult[] {
  try {
    const fullPath = join(basePath, filePath)
    const content = readFileSync(fullPath, 'utf-8')
    const parsed = parseVueComponent(content, filePath)
    if (!parsed) return []

    const results: ScanResult[] = []
    const fileScope = getPrefixFromFilename(filePath)

    // 1. Template strings
    if (parsed.template) {
      const templateResults = extractTemplateStrings(
        parsed.template.content,
        parsed.template.loc.start.line,
      )
      results.push(
        ...templateResults.map((r) => {
          const category = detectCategory(r.value, r.context || 'template')
          return {
            filePath,
            lineNumber: r.line,
            columnNumber: r.column,
            hardcodedString: r.value,
            suggestedKey: generateSmartKey(r.value, fileScope, category),
            context: r.context || 'template',
          }
        }),
      )
    }

    // 2. Script strings
    const scripts = [parsed.script, parsed.scriptSetup].filter(Boolean)
    for (const s of scripts) {
      if (!s) continue
      const scriptResults = extractScriptStrings(s.content, s.loc.start.line)
      results.push(
        ...scriptResults.map((r) => {
          const category = detectCategory(r.value, r.context || 'script', r.isNotification)
          return {
            filePath,
            lineNumber: r.line,
            columnNumber: r.column,
            hardcodedString: r.value,
            suggestedKey: generateSmartKey(r.value, fileScope, category),
            context: r.context || 'script',
            isNotification: r.isNotification,
            notificationType: r.notificationType,
          }
        }),
      )
    }

    return results
  } catch (err) {
    console.error(`[i18n-hunter] Failed to scan Vue file ${filePath}:`, err)
    return []
  }
}

/**
 * Scan a React/TS/JSX script file using the dedicated React AST parser.
 */
function scanScriptFile(filePath: string, basePath: string): ScanResult[] {
  try {
    const fullPath = join(basePath, filePath)
    const content = readFileSync(fullPath, 'utf-8')
    const fileScope = getPrefixFromFilename(filePath)

    const strings = parseReactComponent(content, filePath)

    return strings.map((s) => {
      const category = detectCategory(s.value, s.context, s.isNotification)
      return {
        filePath,
        lineNumber: s.line,
        columnNumber: s.column,
        hardcodedString: s.value,
        suggestedKey: generateSmartKey(s.value, fileScope, category),
        context: s.context,
        isNotification: s.isNotification,
        notificationType: s.notificationType,
      }
    })
  } catch (err) {
    console.error(`[i18n-hunter] Failed to scan script ${filePath}:`, err)
    return []
  }
}

// ─────────────────────────────────────────────
// Intelligence Logic
// ─────────────────────────────────────────────

/**
 * Derives category from the rich context string produced by the parsers.
 * Context format: 'tag:button' | 'tag:label' | 'tag:message' | 'attribute:placeholder:label' | 'script' | etc.
 */
function detectCategory(
  text: string,
  context: string,
  isNotification = false,
): keyof CategorizedResults {
  if (isNotification) return 'notifications'

  // Tag-based (most accurate — comes from HTML/JSX AST)
  if (context.startsWith('tag:button')) return 'buttons'
  if (context.startsWith('tag:label')) return 'labels'
  if (context.startsWith('tag:message')) return 'messages'

  // Attribute-based
  if (context.includes(':label')) return 'labels'
  if (context.includes(':msg')) return 'messages'

  // Script context: check for known error/notification patterns
  if (context.includes('error') || categorizationPatterns.error.some((p: RegExp) => p.test(text.toLowerCase()))) {
    return 'errors'
  }
  if (categorizationPatterns.button.some((p: RegExp) => p.test(text.toLowerCase()))) {
    return 'buttons'
  }

  // Fallback: classify by length
  return text.length > 30 ? 'messages' : 'labels'
}

function getPrefixFromFilename(filePath: string): string {
  const name = basename(filePath)
    .replace(/\.(vue|tsx|jsx|ts|js)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
  
  return name === 'index' || name === 'app' ? 'common' : name
}

function generateSmartKey(text: string, scope: string, category: string): string {
  // Map internal categories to clean key segments
  const categoryMap: Record<string, string> = {
    notifications: 'notify',
    errors: 'error',
    buttons: 'btn',
    messages: 'msg',
    labels: 'lbl',
  }

  const catPrefix = categoryMap[category] || 'lbl'
  
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 20) // A bit longer for more unique keys

  return `${scope}.${catPrefix}.${slug}`
}

function categorizeResults(results: ScanResult[]): CategorizedResults {
  const categorized: CategorizedResults = {
    labels: [],
    buttons: [],
    messages: [],
    errors: [],
    notifications: [],
  }

  for (const r of results) {
    const category = detectCategory(r.hardcodedString, r.context || 'script', r.isNotification)
    categorized[category].push(r)
  }

  return categorized
}

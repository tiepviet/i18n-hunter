/**
 * i18n-hunter Applier
 *
 * Reads an i18n-hunter JSON report (optionally edited by the user),
 * applies the suggested keys to the source files, and creates backups
 * for safe rollback.
 *
 * Supported frameworks:
 *   - Vue 3 (Composition API, <script setup>)  → vue-i18n   → $t() / t()
 *   - React (function components)               → react-i18next → t()
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import type { ExtractionReport, ScanResult } from './types.js'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ApplyOptions {
  /** Directory where reports and manifest are stored */
  outputDir: string
  /** Base project path used to resolve filePaths from the report */
  basePath: string
  /** If true, print changes but do NOT write files */
  dryRun?: boolean
}

export interface ApplyResult {
  modifiedFiles: string[]
  skipped: string[]
  warnings: string[]
  manifestPath: string
}

interface ManifestEntry {
  originalPath: string
  backupPath: string
}

interface Manifest {
  appliedAt: string
  basePath: string
  entries: ManifestEntry[]
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Apply a JSON report to the source files.
 * Creates .bak backups and writes a manifest for rollback.
 */
export function applyReport(
  reportPath: string,
  options: ApplyOptions,
): ApplyResult {
  const { basePath, outputDir, dryRun = false } = options
  const result: ApplyResult = {
    modifiedFiles: [],
    skipped: [],
    warnings: [],
    manifestPath: join(outputDir, '.i18n-hunter-manifest.json'),
  }

  // 1. Read and parse the JSON report
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`)
  }
  const report: ExtractionReport = JSON.parse(readFileSync(reportPath, 'utf-8'))

  if (!report.results?.length) {
    console.log('[i18n-hunter] No results in report — nothing to apply.')
    return result
  }

  // 2. Group results by file
  const byFile = new Map<string, ScanResult[]>()
  for (const r of report.results) {
    if (!byFile.has(r.filePath)) byFile.set(r.filePath, [])
    byFile.get(r.filePath)!.push(r)
  }

  // 3. Process each file
  const manifests: ManifestEntry[] = []

  for (const [relPath, results] of byFile) {
    const absPath = join(basePath, relPath)

    if (!existsSync(absPath)) {
      result.warnings.push(`File not found, skipped: ${relPath}`)
      result.skipped.push(relPath)
      continue
    }

    const originalContent = readFileSync(absPath, 'utf-8')
    const ext = extname(relPath).toLowerCase()
    const isVue = ext === '.vue'

    // 4. Apply replacements bottom-to-top (preserve line offsets)
    const { updatedContent, warnings } = applyToContent(
      originalContent,
      results,
      isVue,
      relPath,
    )

    result.warnings.push(...warnings)

    if (updatedContent === originalContent) {
      result.skipped.push(relPath)
      continue
    }

    // 5. Inject framework import if needed
    const finalContent = injectImport(updatedContent, isVue)

    if (dryRun) {
      console.log(`[dry-run] Would update: ${relPath}`)
      result.modifiedFiles.push(relPath)
      continue
    }

    // 6. Backup then write
    const backupPath = `${absPath}.i18n-hunter.bak`
    copyFileSync(absPath, backupPath)
    writeFileSync(absPath, finalContent, 'utf-8')

    manifests.push({ originalPath: absPath, backupPath })
    result.modifiedFiles.push(relPath)
    console.log(`[i18n-hunter] ✅ Updated: ${relPath}`)
  }

  // 7. Write manifest for rollback
  if (!dryRun && manifests.length > 0) {
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
    const manifest: Manifest = {
      appliedAt: new Date().toISOString(),
      basePath,
      entries: manifests,
    }
    writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    console.log(`[i18n-hunter] Manifest saved: ${result.manifestPath}`)
  }

  return result
}

/**
 * Rollback all files from the last apply run using the manifest.
 */
export function rollbackFromManifest(manifestPath: string): { restored: string[]; errors: string[] } {
  const restored: string[] = []
  const errors: string[] = []

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}. Run 'apply' first.`)
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

  for (const { originalPath, backupPath } of manifest.entries) {
    try {
      if (!existsSync(backupPath)) {
        errors.push(`Backup missing: ${backupPath}`)
        continue
      }
      copyFileSync(backupPath, originalPath)
      restored.push(originalPath)
      console.log(`[i18n-hunter] ↩️  Restored: ${originalPath}`)
    } catch (err) {
      errors.push(`Failed to restore ${originalPath}: ${String(err)}`)
    }
  }

  return { restored, errors }
}

/**
 * Clean up all .bak files and the manifest after a confirmed apply.
 * Call this when you've verified the changes look good.
 */
export function cleanBackups(manifestPath: string): { deleted: string[]; errors: string[] } {
  const deleted: string[] = []
  const errors: string[] = []

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}. Nothing to clean.`)
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

  for (const { backupPath } of manifest.entries) {
    try {
      if (existsSync(backupPath)) {
        unlinkSync(backupPath)
        deleted.push(backupPath)
        console.log(`[i18n-hunter] 🗑  Removed backup: ${backupPath}`)
      }
    } catch (err) {
      errors.push(`Failed to remove ${backupPath}: ${String(err)}`)
    }
  }

  // Remove the manifest itself
  try {
    unlinkSync(manifestPath)
    deleted.push(manifestPath)
    console.log(`[i18n-hunter] 🗑  Removed manifest: ${manifestPath}`)
  } catch (err) {
    errors.push(`Failed to remove manifest: ${String(err)}`)
  }

  return { deleted, errors }
}

// ─────────────────────────────────────────────
// Core replacement logic
// ─────────────────────────────────────────────

/**
 * Apply all scan results to a file's content.
 * Processes results in reverse line order to preserve line positions.
 */
function applyToContent(
  content: string,
  results: ScanResult[],
  isVue: boolean,
  filePath: string,
): { updatedContent: string; warnings: string[] } {
  const warnings: string[] = []
  const lines = content.split('\n')

  // Sort descending by line then column — replace bottom-to-top to keep offsets stable
  const sorted = [...results].sort((a, b) => {
    if (a.lineNumber !== b.lineNumber) return b.lineNumber - a.lineNumber
    return b.columnNumber - a.columnNumber
  })

  for (const r of sorted) {
    const lineIdx = r.lineNumber - 1
    if (lineIdx < 0 || lineIdx >= lines.length) {
      warnings.push(`${filePath}:${r.lineNumber} — line out of bounds, skipped`)
      continue
    }

    const original = lines[lineIdx]
    const replaced = replaceLine(original, r.hardcodedString, r.suggestedKey, r.context, isVue)

    if (replaced === original) {
      warnings.push(`${filePath}:${r.lineNumber} — could not locate "${r.hardcodedString}", skipped`)
    } else {
      lines[lineIdx] = replaced
    }
  }

  return { updatedContent: lines.join('\n'), warnings }
}

/**
 * Replace a hardcoded string within a single line using context for syntax decisions.
 *
 * Context types (from parsers):
 *   'tag:button' | 'tag:label' | 'tag:message' | 'tag:*'  → text node inside a tag
 *   'text-node'                                             → generic text in Vue template
 *   'attribute:attrName:label' | 'attribute:attrName'      → HTML/JSX attribute value
 *   'script' | 'jsx-script' | 'notification:*'             → string in JS/TS logic
 *   'template-literal'                                      → template literal (skip for now)
 */
function replaceLine(
  line: string,
  value: string,
  key: string,
  context: string,
  isVue: boolean,
): string {
  const safe = escapeRegex(value)

  // ── Text / tag context ──────────────────────────────────────────────────

  if (context.startsWith('tag:') || context === 'text-node') {
    if (isVue) {
      // Vue template text node: >Text< → >{{ $t('key') }}<
      // Attempt exact match first, then looser
      if (line.includes(value)) {
        return line.replace(value, `{{ $t('${key}') }}`)
      }
    } else {
      // React JSX text node: >Text< → >{t('key')}<
      if (line.includes(value)) {
        return line.replace(value, `{t('${key}')}`)
      }
    }
    return line
  }

  // ── Attribute context ───────────────────────────────────────────────────

  if (context.startsWith('attribute:')) {
    const attrName = context.split(':')[1]

    // Never replace structural/technical attributes — only human-facing ones
    const SKIP_ATTRS = new Set([
      'class', 'id', 'style', 'type', 'name', 'for', 'role', 'tabindex',
      'href', 'src', 'to', 'target', 'rel', 'method', 'action', 'key',
      'ref', 'slot', 'is', 'size', 'variant', 'color', 'icon',
    ])
    const SKIP_PREFIXES = ['data-', 'aria-', 'on', 'v-', '@', ':', '#']

    if (
      SKIP_ATTRS.has(attrName) ||
      SKIP_PREFIXES.some((p) => attrName.startsWith(p))
    ) {
      return line
    }

    if (isVue) {
      // Vue: label="Value" → :label="$t('key')"
      const dq = new RegExp(`(\\s)(${attrName})="(${safe})"`)
      const sq = new RegExp(`(\\s)(${attrName})='(${safe})'`)
      if (dq.test(line)) return line.replace(dq, `$1:$2="$t('${key}')"`)
      if (sq.test(line)) return line.replace(sq, `$1:$2="$t('${key}')"`)

      // Attribute at start of line / without leading space
      const dqNoSpace = new RegExp(`^(\\s*)(${attrName})="(${safe})"`)
      if (dqNoSpace.test(line)) return line.replace(dqNoSpace, `$1:$2="$t('${key}')"`)
    } else {
      // React: label="Value" → label={t('key')}
      const dq = new RegExp(`(${attrName})="(${safe})"`)
      const sq = new RegExp(`(${attrName})='(${safe})'`)
      if (dq.test(line)) return line.replace(dq, `$1={t('${key}')}`)
      if (sq.test(line)) return line.replace(sq, `$1={t('${key}')}`)
    }

    return line
  }

  // ── Script / notification context ──────────────────────────────────────

  if (
    context === 'script' ||
    context === 'jsx-script' ||
    context.startsWith('notification:')
  ) {
    // Replace quoted string with t('key')
    const dq = new RegExp(`"(${safe})"`)
    const sq = new RegExp(`'(${safe})'`)
    const tq = new RegExp(`\`(${safe})\``)

    if (dq.test(line)) return line.replace(dq, `t('${key}')`)
    if (sq.test(line)) return line.replace(sq, `t('${key}')`)
    if (tq.test(line)) return line.replace(tq, `t('${key}')`)

    return line
  }

  return line
}

// ─────────────────────────────────────────────
// Import injection
// ─────────────────────────────────────────────

/**
 * Inject i18n import and hook into a file if not already present.
 *
 * Vue  → import { useI18n } from 'vue-i18n'    + const { t } = useI18n()
 * React → import { useTranslation } from 'react-i18next' + const { t } = useTranslation()
 */
function injectImport(content: string, isVue: boolean): string {
  return isVue ? injectVueI18n(content) : injectReactI18n(content)
}

/**
 * Vue 3 Composition API injection:
 *   - Adds `import { useI18n } from 'vue-i18n'` if missing
 *   - Adds `const { t } = useI18n()` after imports in <script setup>
 */
function injectVueI18n(content: string): string {
  const hasImport = /from\s+['"]vue-i18n['"]/.test(content)
  const hasT = /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useI18n\s*\(/.test(content)

  if (hasImport && hasT) return content

  const lines = content.split('\n')

  // Find the <script> or <script setup> opening line index
  const scriptOpenIdx = lines.findIndex((l) => /^\s*<script/.test(l))
  if (scriptOpenIdx === -1) return content // no script block — leave unchanged

  // Insert import after <script ...> tag line if needed
  let insertImportAt = scriptOpenIdx + 1
  if (!hasImport) {
    // Prefer to add after existing 'import' statements in the block
    let lastImportInBlock = scriptOpenIdx
    for (let i = scriptOpenIdx + 1; i < lines.length; i++) {
      if (/^\s*<\/script/.test(lines[i])) break
      if (/^\s*import\s/.test(lines[i])) lastImportInBlock = i
    }
    insertImportAt = lastImportInBlock + 1
    lines.splice(insertImportAt, 0, "import { useI18n } from 'vue-i18n'")
  }

  if (!hasT) {
    // Find position to inject const { t } = useI18n() — after all imports
    let afterImports = insertImportAt + (hasImport ? 0 : 1)
    for (let i = afterImports; i < lines.length; i++) {
      if (/^\s*<\/script/.test(lines[i])) break
      if (/^\s*import\s/.test(lines[i])) afterImports = i + 1
    }

    // Insert blank line + hook if not already there
    const indent = detectIndent(lines, scriptOpenIdx)
    lines.splice(afterImports, 0, '', `${indent}const { t } = useI18n()`)
  }

  return lines.join('\n')
}

/**
 * React injection (react-i18next, best practice):
 *   - Adds `import { useTranslation } from 'react-i18next'` if missing
 *   - Adds `const { t } = useTranslation()` at top of each component function body
 *
 * Safe: only touches files with JSX/TSX, preserves all indentation.
 */
function injectReactI18n(content: string): string {
  const hasImport = /from\s+['"]react-i18next['"]/.test(content)
  const hasT = /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\s*\(/.test(content)

  if (hasImport && hasT) return content

  const lines = content.split('\n')

  // ─── 1. Inject import ────────────────────────────────────────────────────
  if (!hasImport) {
    // Find the last import line at the top of the file
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('import ')) lastImportIdx = i
      else if (trimmed && !trimmed.startsWith('/') && !trimmed.startsWith('*')) break
    }

    const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0
    lines.splice(insertAt, 0, "import { useTranslation } from 'react-i18next'")
  }

  // ─── 2. Inject hook inside component body ────────────────────────────────
  if (!hasT) {
    // Detect React component function patterns (handles most real-world cases):
    //   function Foo() {
    //   const Foo = () => {
    //   const Foo = (props: Props) => {
    //   export default function() {
    //   const Foo: FC = () => {
    const componentRe =
      /^(\s*)(export\s+default\s+|export\s+)?(function\s+\w*|const\s+\w+\s*(?::\s*\S+)?\s*=\s*(?:\([^)]*\)|)\s*=>)\s*\{/

    for (let i = 0; i < lines.length; i++) {
      if (componentRe.test(lines[i])) {
        const indent = detectIndent(lines, i, 2)
        // Insert hook on the very next line, before any existing content
        lines.splice(i + 1, 0, `${indent}const { t } = useTranslation()`)
        break // Only inject once — single component per file pattern
      }
    }
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Detect the indentation level from surrounding lines.
 * Falls back to `defaultSpaces` spaces if detection fails.
 */
function detectIndent(lines: string[], refIdx: number, defaultSpaces = 0): string {
  // Look at the line after refIdx for existing indentation
  for (let i = refIdx + 1; i < Math.min(refIdx + 5, lines.length); i++) {
    const m = lines[i].match(/^(\s+)/)
    if (m) return m[1]
  }
  return ' '.repeat(defaultSpaces)
}

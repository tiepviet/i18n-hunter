/**
 * Vue Component Parser
 *
 * Parses Vue SFCs using @vue/compiler-sfc and @vue/compiler-dom AST.
 * Exclusively handles .vue files — React/JSX files are handled by react-parser.ts.
 */

import { parse } from '@vue/compiler-sfc'
import {
  parse as parseTemplate,
  type ElementNode,
  type TextNode,
  type AttributeNode,
  NodeTypes,
} from '@vue/compiler-dom'
import type { ParsedVueComponent } from './types.js'

// ─────────────────────────────────────────────
// Tag classification maps (Vue-specific tags included)
// ─────────────────────────────────────────────

const BUTTON_TAGS = new Set([
  'button', 'a', 'router-link', 'RouterLink', 'nuxt-link', 'NuxtLink',
  'el-button', 'v-btn', 'b-button', 'ion-button',
])

const LABEL_TAGS = new Set([
  'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'title', 'th', 'caption', 'legend', 'dt',
])

const MESSAGE_TAGS = new Set([
  'p', 'span', 'li', 'td', 'blockquote',
  'figcaption', 'summary', 'dd',
])

const LABEL_ATTRS = new Set([
  'label', 'placeholder', 'title', 'alt', 'tooltip',
])

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Parse a Vue SFC into template, script, and scriptSetup sections.
 * Returns `null` when the file cannot be parsed.
 */
export function parseVueComponent(content: string, filePath: string): ParsedVueComponent | null {
  try {
    const { descriptor, errors } = parse(content, { filename: filePath })

    if (errors.length > 0) {
      console.warn(`[i18n-hunter] Parse warnings in ${filePath}:`, errors.map((e) => e.message))
    }

    const result: ParsedVueComponent = { filePath }

    if (descriptor.template) {
      result.template = {
        content: descriptor.template.content,
        loc: {
          start: { line: descriptor.template.loc.start.line, column: descriptor.template.loc.start.column },
          end: { line: descriptor.template.loc.end.line, column: descriptor.template.loc.end.column },
        },
      }
    }

    if (descriptor.script) {
      result.script = {
        content: descriptor.script.content,
        loc: {
          start: { line: descriptor.script.loc.start.line, column: descriptor.script.loc.start.column },
          end: { line: descriptor.script.loc.end.line, column: descriptor.script.loc.end.column },
        },
      }
    }

    if (descriptor.scriptSetup) {
      result.scriptSetup = {
        content: descriptor.scriptSetup.content,
        loc: {
          start: { line: descriptor.scriptSetup.loc.start.line, column: descriptor.scriptSetup.loc.start.column },
          end: { line: descriptor.scriptSetup.loc.end.line, column: descriptor.scriptSetup.loc.end.column },
        },
      }
    }

    return result
  } catch (error) {
    console.error(`[i18n-hunter] Error parsing ${filePath}:`, error)
    return null
  }
}

/**
 * Extract hardcoded strings from a Vue template using @vue/compiler-dom AST.
 * Parent element tags are propagated to each string for accurate categorization.
 * Falls back to regex extraction on parse failure.
 */
export function extractTemplateStrings(
  template: string,
  startLine: number,
): Array<{ value: string; line: number; column: number; context: string }> {
  try {
    const ast = parseTemplate(template, {
      comments: false,
      onError: (err) => console.warn('[i18n-hunter] Template parse warning:', err.message),
    })
    const results: Array<{ value: string; line: number; column: number; context: string }> = []
    walkAST(ast, results, startLine, null)
    return results
  } catch {
    return extractTemplateFallback(template, startLine)
  }
}

/**
 * Extract hardcoded strings from a Vue <script> or <script setup> block.
 * Detects notification calls (toast.success, etc.) for richer context.
 */
export function extractScriptStrings(
  script: string,
  startLine: number,
): Array<{
  value: string
  line: number
  column: number
  context: string
  isNotification?: boolean
  notificationType?: 'success' | 'error' | 'info' | 'warning'
}> {
  const results: Array<{
    value: string
    line: number
    column: number
    context: string
    isNotification?: boolean
    notificationType?: 'success' | 'error' | 'info' | 'warning'
  }> = []

  const stringPatterns = [
    /\"([^\"\\]*(\\.[^\"\\]*)*)\"/g,
    /'([^'\\]*(\\.[^'\\]*)*)'/g,
    /`([^`\\]*(\\.[^`\\]*)*)`/g,
  ]

  const lines = script.split('\n')

  lines.forEach((line, index) => {
    const lineNumber = startLine + index
    const trimmed = line.trim()

    if (isI18nLine(trimmed)) return
    if (/console\.(log|error|warn|info|debug|trace)\s*\(/.test(trimmed)) return

    const notifType = getNotificationType(trimmed)

    stringPatterns.forEach((pattern) => {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = pattern.exec(line)) !== null) {
        const value = match[1]
        if (!value?.trim() || isTechnical(value, trimmed)) continue

        results.push({
          value,
          line: lineNumber,
          column: match.index + 1,
          context: notifType ? `notification:${notifType}` : 'script',
          isNotification: !!notifType,
          notificationType: notifType ?? undefined,
        })
      }
    })
  })

  return results
}

// ─────────────────────────────────────────────
// Internal — context resolution
// ─────────────────────────────────────────────

function resolveContext(parentTag: string | null, attrName?: string): string {
  if (attrName) {
    return LABEL_ATTRS.has(attrName)
      ? `attribute:${attrName}:label`
      : `attribute:${attrName}`
  }
  if (!parentTag) return 'text-node'
  const tag = parentTag.toLowerCase()
  if (BUTTON_TAGS.has(parentTag) || BUTTON_TAGS.has(tag)) return 'tag:button'
  if (LABEL_TAGS.has(tag)) return 'tag:label'
  if (MESSAGE_TAGS.has(tag)) return 'tag:message'
  return `tag:${tag}`
}

// ─────────────────────────────────────────────
// Internal — AST walker
// ─────────────────────────────────────────────

const SKIP_ATTRS = new Set([
  'class', 'id', 'style', 'type', 'name', 'for', 'role',
  'key', 'ref', 'is', 'slot', 'slot-scope',
  'size', 'variant', 'color', 'icon', 'loading', 'disabled',
  'href', 'to', 'target', 'rel', 'method', 'action',
])
const SKIP_PREFIXES = ['data-', 'aria-', '@', ':', 'v-', '#']

function shouldSkip(attrName: string): boolean {
  return SKIP_ATTRS.has(attrName) || SKIP_PREFIXES.some((p) => attrName.startsWith(p))
}

function walkAST(
  node: any,
  results: Array<{ value: string; line: number; column: number; context: string }>,
  startLine: number,
  parentTag: string | null,
): void {
  if (!node) return

  if (node.type === NodeTypes.TEXT) {
    const text = node as TextNode
    const value = text.content.trim()
    if (value && !isI18nLine(value)) {
      results.push({
        value,
        line: startLine + (text.loc?.start.line ?? 1) - 1,
        column: text.loc?.start.column ?? 0,
        context: resolveContext(parentTag),
      })
    }
    return
  }

  if (node.type === NodeTypes.INTERPOLATION) return

  if (node.type === NodeTypes.ELEMENT) {
    const el = node as ElementNode
    const tag = el.tag ?? null

    for (const prop of el.props ?? []) {
      if (prop.type !== NodeTypes.ATTRIBUTE) continue
      const attr = prop as AttributeNode
      if (!attr.value?.content || shouldSkip(attr.name)) continue

      const value = attr.value.content.trim()
      if (value && !isI18nLine(value)) {
        results.push({
          value,
          line: startLine + (attr.loc?.start.line ?? 1) - 1,
          column: attr.loc?.start.column ?? 0,
          context: resolveContext(tag, attr.name),
        })
      }
    }

    for (const child of el.children ?? []) {
      walkAST(child, results, startLine, tag)
    }
    return
  }

  for (const child of node.children ?? []) {
    walkAST(child, results, startLine, parentTag)
  }
}

// ─────────────────────────────────────────────
// Internal — fallback (regex-based)
// ─────────────────────────────────────────────

function extractTemplateFallback(
  template: string,
  startLine: number,
): Array<{ value: string; line: number; column: number; context: string }> {
  const results: Array<{ value: string; line: number; column: number; context: string }> = []
  template.split('\n').forEach((line, i) => {
    const lineNumber = startLine + i
    const textRe = />([^<>]+)</g
    const attrRe = /(\w+)\s*=\s*["']([^"']+)["']/g
    let m: RegExpExecArray | null

    while ((m = textRe.exec(line)) !== null) {
      const value = m[1]?.trim()
      if (value && !value.startsWith('{{') && !isI18nLine(value)) {
        results.push({ value, line: lineNumber, column: m.index + 1, context: 'text-node' })
      }
    }

    while ((m = attrRe.exec(line)) !== null) {
      const name = m[1]
      const value = m[2]?.trim()
      if (!shouldSkip(name) && value && !isI18nLine(value)) {
        results.push({ value, line: lineNumber, column: m.index + 1, context: `attribute:${name}` })
      }
    }
  })
  return results
}

// ─────────────────────────────────────────────
// Internal — filters
// ─────────────────────────────────────────────

function isI18nLine(text: string): boolean {
  return [/\$t\s*\(/, /\bt\s*\(/, /v-t\s*=/, /\{\{\s*\$t\s*\(/, /\{\{\s*t\s*\(/]
    .some((p) => p.test(text))
}

function isTechnical(value: string, lineCtx: string): boolean {
  if (!value.trim()) return true
  if (value.startsWith('/') || /^https?:\/\//.test(value)) return true
  if (lineCtx.includes('console.')) return true
  if (/^[a-z][a-zA-Z0-9_]*$/.test(value) && !value.includes(' ')) return true
  return false
}

function getNotificationType(line: string): 'success' | 'error' | 'info' | 'warning' | null {
  if (/toast\.success\s*\(/.test(line)) return 'success'
  if (/toast\.error\s*\(/.test(line)) return 'error'
  if (/toast\.info\s*\(/.test(line)) return 'info'
  if (/toast\.warn(ing)?\s*\(/.test(line)) return 'warning'
  return null
}

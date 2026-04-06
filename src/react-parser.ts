/**
 * React / JSX Parser
 *
 * Parses .tsx, .jsx, .ts, .js files using @babel/parser.
 * Traverses the full JSX AST to extract hardcoded strings with:
 *   - Parent tag context (button, p, h1, label, etc.)
 *   - Script-level string literals
 *   - Notification / error context from call expressions
 */

import { parse } from '@babel/parser'
import * as t from '@babel/types'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ExtractedString {
  value: string
  line: number
  column: number
  context: string
  isNotification?: boolean
  notificationType?: 'success' | 'error' | 'info' | 'warning'
}

// ─────────────────────────────────────────────
// Tag classification maps
// ─────────────────────────────────────────────

const BUTTON_TAGS = new Set([
  'button', 'a', 'RouterLink', 'NavLink', 'Link', 'Button',
])

const LABEL_TAGS = new Set([
  'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'title', 'th', 'legend', 'dt', 'caption', 'Title', 'Heading',
])

const MESSAGE_TAGS = new Set([
  'p', 'span', 'li', 'td', 'blockquote', 'figcaption', 'summary', 'dd',
  'Text', 'Paragraph',
])

const LABEL_ATTRS = new Set([
  'label', 'placeholder', 'title', 'alt', 'aria-label', 'tooltip',
])

// ─────────────────────────────────────────────
// Context resolution
// ─────────────────────────────────────────────

function resolveTagContext(tagName: string | null): string {
  if (!tagName) return 'jsx-text'
  if (BUTTON_TAGS.has(tagName)) return 'tag:button'
  if (LABEL_TAGS.has(tagName)) return 'tag:label'
  if (MESSAGE_TAGS.has(tagName)) return 'tag:message'
  return `tag:${tagName.toLowerCase()}`
}

function resolveAttrContext(attrName: string): string {
  if (LABEL_ATTRS.has(attrName)) return `attribute:${attrName}:label`
  return `attribute:${attrName}`
}

// ─────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────

const I18N_PATTERNS = [
  /\bt\s*\(/, /\$t\s*\(/, /i18n\.t\s*\(/, /useTranslation/,
  /formatMessage/, /intl\.formatMessage/,
]

function isI18nString(value: string): boolean {
  return I18N_PATTERNS.some((p) => p.test(value))
}

function isTechnical(value: string): boolean {
  if (!value || value.length <= 1) return true
  if (/^https?:\/\//.test(value)) return true
  if (value.startsWith('/') && !value.includes(' ')) return true
  if (/^[a-z][a-zA-Z0-9_-]*$/.test(value) && !value.includes(' ')) return true
  if (/^[0-9\s.,:|/-]+$/.test(value)) return true
  return false
}

function getNotificationType(callee: string): 'success' | 'error' | 'info' | 'warning' | null {
  if (/toast\.success|notify\.success/.test(callee)) return 'success'
  if (/toast\.error|notify\.error/.test(callee)) return 'error'
  if (/toast\.info|notify\.info/.test(callee)) return 'info'
  if (/toast\.warn(ing)?|notify\.warn/.test(callee)) return 'warning'
  return null
}

// ─────────────────────────────────────────────
// AST Traversal
// ─────────────────────────────────────────────

function getJSXTagName(node: t.JSXOpeningElement): string | null {
  const name = node.name
  if (t.isJSXIdentifier(name)) return name.name
  if (t.isJSXMemberExpression(name)) return null // e.g., <Foo.Bar>
  return null
}

function getCalleeString(node: t.CallExpression): string {
  const callee = node.callee
  if (t.isIdentifier(callee)) return callee.name
  if (t.isMemberExpression(callee)) {
    const obj = t.isIdentifier(callee.object) ? callee.object.name : ''
    const prop = t.isIdentifier(callee.property) ? callee.property.name : ''
    return `${obj}.${prop}`
  }
  return ''
}

/**
 * Recursively walk a Babel AST node, collecting hardcoded strings.
 * `parentTag` carries the JSX element name from the enclosing element.
 */
function walkNode(
  node: t.Node | null | undefined,
  results: ExtractedString[],
  parentTag: string | null = null,
): void {
  if (!node) return

  // ── JSX Element ──────────────────────────────
  if (t.isJSXElement(node)) {
    const tagName = getJSXTagName(node.openingElement)

    // Process JSX attributes on the opening element
    for (const attr of node.openingElement.attributes) {
      if (!t.isJSXAttribute(attr)) continue
      const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
      if (!attrName) continue

      // String literal attribute: label="Logout"
      if (t.isStringLiteral(attr.value)) {
        const value = attr.value.value.trim()
        if (value && !isTechnical(value) && !isI18nString(value)) {
          results.push({
            value,
            line: attr.value.loc?.start.line ?? 0,
            column: attr.value.loc?.start.column ?? 0,
            context: resolveAttrContext(attrName),
          })
        }
      }

      // Expression attribute: label={...}
      if (t.isJSXExpressionContainer(attr.value)) {
        walkNode(attr.value.expression, results, tagName)
      }
    }

    // Process children with current tag as parent
    for (const child of node.children) {
      walkNode(child, results, tagName)
    }
    return
  }

  // ── JSX Text ─────────────────────────────────
  if (t.isJSXText(node)) {
    const value = node.value.trim()
    if (value && value.length > 1 && !isTechnical(value) && !isI18nString(value)) {
      results.push({
        value,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
        context: resolveTagContext(parentTag),
      })
    }
    return
  }

  // ── String Literal (in script) ────────────────
  if (t.isStringLiteral(node)) {
    const value = node.value.trim()
    if (value && value.length > 1 && !isTechnical(value) && !isI18nString(value)) {
      results.push({
        value,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
        context: parentTag ? resolveTagContext(parentTag) : 'script',
      })
    }
    return
  }

  // ── Template Literal ──────────────────────────
  if (t.isTemplateLiteral(node)) {
    if (node.quasis.length === 1) {
      const value = node.quasis[0].value.cooked?.trim() ?? ''
      if (value && value.length > 1 && !isTechnical(value) && !isI18nString(value)) {
        results.push({
          value,
          line: node.loc?.start.line ?? 0,
          column: node.loc?.start.column ?? 0,
          context: 'template-literal',
        })
      }
    }
    return
  }

  // ── Call Expression ───────────────────────────
  // Capture: toast.success("Message") etc.
  if (t.isCallExpression(node)) {
    const callee = getCalleeString(node)
    const notifType = getNotificationType(callee)

    for (const arg of node.arguments) {
      if (t.isStringLiteral(arg)) {
        const value = arg.value.trim()
        if (value && !isTechnical(value)) {
          results.push({
            value,
            line: arg.loc?.start.line ?? 0,
            column: arg.loc?.start.column ?? 0,
            context: notifType ? `notification:${notifType}` : 'script',
            isNotification: !!notifType,
            notificationType: notifType ?? undefined,
          })
        }
      } else if (t.isNode(arg)) {
        walkNode(arg, results, parentTag)
      }
    }
    return
  }

  // ── Generic: recurse into all child nodes ─────
  for (const key of Object.keys(node)) {
    const child = (node as any)[key]
    if (!child || typeof child !== 'object') continue
    if (Array.isArray(child)) {
      child.forEach((c) => t.isNode(c) && walkNode(c, results, parentTag))
    } else if (t.isNode(child)) {
      walkNode(child, results, parentTag)
    }
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Parse a React/JSX/TSX file and extract all hardcoded strings
 * using the @babel/parser AST.
 */
export function parseReactComponent(
  content: string,
  filePath: string,
): ExtractedString[] {
  try {
    const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx')

    const ast = parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      plugins: [
        'jsx',
        ...(isTS ? (['typescript'] as const) : []),
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
    })

    const results: ExtractedString[] = []
    walkNode(ast.program as unknown as t.Node, results, null)
    return results
  } catch (err) {
    console.error(`[i18n-hunter] Failed to parse React file ${filePath}:`, err)
    return []
  }
}

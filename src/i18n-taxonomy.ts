import type { FindingCategory } from './types.js'

/**
 * Single source of truth for user-facing string classification.
 * Both the Vue template parser and the shared Babel extractor must agree,
 * otherwise identical strings are categorized/filtered differently per framework.
 *
 * Only kebab-case user-facing attrs are extracted: custom camelCase props
 * (e.g. `myProp` normalized to `my-prop`) are intentionally not extracted.
 * The report schema accepts `attribute:myProp` for forward-compat with
 * hand-written reports, not as scanner output.
 */
export const userFacingAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-valuetext',
  'content',
  'label',
  'placeholder',
  'title',
  'tooltip',
])

export const userFacingVariableNames = new Set([
  'alert',
  'description',
  'detail',
  'emptyText',
  'error',
  'errorText',
  'heading',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'text',
  'title',
  'warning',
])

export const notificationCallees = new Set(['toast', 'notify', 'notification', 'alert', 'message'])

export const technicalCallees = new Set([
  'JSON',
  'axios',
  'console',
  'fetch',
  'history',
  'localStorage',
  'querySelector',
  'require',
  'router',
  'sessionStorage',
  'setItem',
  'store',
  'store.setItem',
  'window.location',
])

export const translationModules = new Set([
  'i18next',
  'i18n',
  'react-i18next',
  'react-intl',
  'vue-i18n',
  'next-intl',
  'next-intl/server',
  '@lingui/core',
  '@lingui/macro',
  '@lingui/react',
  'ttag',
])

const buttonTagNames = new Set([
  'a',
  'button',
  'el-button',
  'link',
  'navlink',
  'nuxt-link',
  'router-link',
  'routerlink',
])

export const buttonTags = buttonTagNames

export const labelTags = new Set([
  'caption',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'legend',
  'th',
  'title',
])

export const messageTags = new Set([
  'blockquote',
  'dd',
  'figcaption',
  'li',
  'p',
  'span',
  'summary',
  'td',
])

const errorPattern =
  /\b(error|errors|fail|failed|failure|invalid|incorrect|wrong|forbidden|denied|missing)\b/iu

export function categoryForTag(tag: string | null, value: string): FindingCategory {
  if (!tag) return 'message'
  // Error values take precedence over tag names so `<p>Invalid…</p>` is an
  // error in both Vue and React paths.
  if (errorPattern.test(value)) return 'error'
  const normalized = tag.toLowerCase()
  if (buttonTagNames.has(normalized)) return 'button'
  if (labelTags.has(normalized)) return 'label'
  if (messageTags.has(normalized)) return 'message'
  if (value.length > 30) return 'message'
  return 'label'
}

export function categoryForContext(context: string, value: string): FindingCategory {
  if (context.startsWith('notification:')) return 'notification'
  if (context.startsWith('tag:')) return categoryForTag(context.slice(4), value)
  if (errorPattern.test(value)) return 'error'
  if (context.includes('error')) return 'error'
  if (value.length > 30) return 'message'
  return 'label'
}

/**
 * Normalize an attribute name for taxonomy lookup: camelCase → kebab-case,
 * then lowercase (e.g. `ariaLabel` → `aria-label`, `ARIALABEL` → `aria-label`).
 * Both Vue (already lowercased) and React (exact case) paths must agree.
 * Fail-closed: unknown names return lowercased kebab form for exact Set lookup.
 */
export function normalizeAttributeName(name: string): string {
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  if (kebab === 'arialabel') return 'aria-label'
  // All-caps/lowercase `aria*` without a hyphen (`ariadescription`) → `aria-description`.
  if (/^aria[a-z]+$/u.test(kebab) && kebab.length > 4 && !kebab.includes('-')) {
    return `aria-${kebab.slice(4)}`
  }
  return kebab
}

export function isVisibleText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value)
}

/**
 * Technical values (URLs, data URIs, paths, file references) are never findings.
 * The path-like pattern deliberately requires a `/` or `.` separator so locale
 * codes (`en-US`) and kebab-case words are not filtered as technical.
 */
export function isTechnicalValue(value: string): boolean {
  const trimmed = value.trim()
  if (/^(?:https?:\/\/|data:|application\/|text\/|\/|\.{0,2}\/|[A-Za-z]:\\)/iu.test(trimmed)) {
    return true
  }
  if (!trimmed.includes('/') && !trimmed.includes('.')) return false
  return /^[a-z0-9_.@~+-]+(?:[./\\_-][a-z0-9_.@~+-]+)+$/iu.test(trimmed)
}

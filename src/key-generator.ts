import { createHash } from 'node:crypto'
import type { FindingCategory } from './types.js'

const categorySegments: Record<FindingCategory, string> = {
  label: 'lbl',
  button: 'btn',
  message: 'msg',
  error: 'error',
  notification: 'notify',
}

/**
 * Mirrors `keySchema` in `report-schema.ts`, which accepts at most 15
 * dot-separated segments and 200 characters. Keeping these here means a key can
 * never be generated that the report schema would then reject.
 */
const MAX_KEY_SEGMENTS = 15
const MAX_SCOPE_SEGMENTS = MAX_KEY_SEGMENTS - 2 // one for the category, one for the value
const MAX_KEY_LENGTH = 200

export function generateSmartKey(text: string, scope: string, category: FindingCategory): string {
  const scopeSegments = sanitizeScope(scope)
  const safeScope =
    scopeSegments.length > 0 ? scopeSegments.slice(-MAX_SCOPE_SEGMENTS).join('.') : 'common'
  const valueSegment = sanitizeValue(text)
  const key = `${safeScope}.${categorySegments[category]}.${valueSegment}`

  if (key.length <= MAX_KEY_LENGTH) return key
  const suffix = `__${shortHash(key)}`
  return `${key.slice(0, MAX_KEY_LENGTH - suffix.length)}${suffix}`
}

export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function sanitizeScope(scope: string): string[] {
  return scope
    .split(/[./\\]/u)
    .map((segment) => normalizeForKey(segment))
    .filter(Boolean)
    .map((segment) =>
      segment.length <= 48 ? segment : `${segment.slice(0, 39)}__${shortHash(segment)}`,
    )
}

function sanitizeValue(text: string): string {
  const normalized = normalizeForKey(text)
  if (normalized) return normalized.slice(0, 96).replace(/^_+|_+$/g, '') || `u_${shortHash(text)}`
  return `u_${shortHash(text)}`
}

function normalizeForKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

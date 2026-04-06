/**
 * i18n Scanner Configuration
 *
 * Default configuration and exclusion/categorization patterns.
 */

import type { ScannerConfig } from './types.js'

/**
 * Default scanner configuration.
 *
 * Covers common source directory conventions for Vue and React projects.
 * Override via `scanPaths` when calling {@link scanForHardcodedStrings}.
 */
export const defaultScannerConfig: ScannerConfig = {
  scanPaths: ['src/features', 'src/shared/components', 'src/app/widgets', 'src/app/layouts', 'src/components', 'src/views', 'src/pages'],

  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/*.test.vue',
    '**/*.spec.vue',
    '**/__tests__/**',
  ],

  includePatterns: ['**/*.{vue,ts,tsx,js,jsx}'],
}

export const DEFAULT_EXTENSIONS = ['.vue', '.ts', '.js', '.tsx', '.jsx'];

/**
 * Patterns used to decide whether a detected string should be skipped.
 */
export const exclusionPatterns = {
  /** Strings already using vue-i18n APIs */
  i18nUsage: [
    /\$t\s*\(/,
    /\bt\s*\(/,
    /v-t\s*=/,
    /v-t\s*:/,
    /useI18n/,
    /\$tc\s*\(/,
    /tc\s*\(/,
    /\$te\s*\(/,
    /te\s*\(/,
    /i18n\.global\.t\s*\(/,
  ],

  /** API endpoints and URLs */
  apiEndpoints: [
    /^\/api\//,
    /^\/v\d+\//,
    /^https?:\/\//,
    /^wss?:\/\//,
    /^\/[a-z0-9-_/]+$/i,
    /\.(json|xml|csv|txt)$/i,
    /^[a-z]+:\/\//i,
  ],

  /** HTML / component attribute names */
  technicalAttributes: [
    /^class$/,
    /^id$/,
    /^data-/,
    /^aria-/,
    /^role$/,
    /^type$/,
    /^name$/,
    /^value$/,
    /^placeholder$/,
    /^href$/,
    /^src$/,
    /^alt$/,
    /^title$/,
    /^rel$/,
    /^target$/,
    /^method$/,
    /^action$/,
  ],

  /** Console / logger calls in surrounding context */
  debugOutput: [
    /console\.(log|error|warn|info|debug|trace|table|group|groupEnd)/,
    /debugger/,
    /\bLogger\./,
    /\blog\s*\(/,
  ],

  /** Empty or whitespace-only strings */
  emptyStrings: [/^\s*$/, /^[\n\r\t ]+$/],

  /** Technical identifiers (variable / class names) */
  technicalIdentifiers: [
    /^[a-z][a-zA-Z0-9_]*$/,
    /^[A-Z][a-zA-Z0-9_]*$/,
    /^[A-Z_]+$/,
    /^_[a-zA-Z0-9_]+$/,
    /^\$[a-zA-Z0-9_]+$/,
  ],

  /** Tailwind / utility CSS class patterns */
  cssPatterns: [
    /\b(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky)\b/,
    /\b(top|bottom|left|right|inset)-/,
    /\b(w|h|min-w|min-h|max-w|max-h)-/,
    /\b(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr)-/,
    /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/,
    /\btext-(left|center|right|justify)\b/,
    /\bbg-/,
    /\bborder(-[a-z]+)?-/,
    /\brounded(-[a-z]+)?/,
    /\bshadow(-[a-z]+)?/,
    /\bz-\d+/,
    /\bopacity-\d+/,
    /\btransform\b/,
    /\btransition(-[a-z]+)?/,
    /\b(hover|focus|active|disabled|group-hover):/,
    /^[a-z][a-z0-9-_]*$/i,
  ],

  /** File paths */
  filePaths: [
    /^[./\\]/,
    /\.(js|ts|vue|json|css|scss|html|md|txt|log)$/i,
    /^~\//,
    /^@\//,
  ],

  /** Date/time and CSS value formats */
  technicalFormats: [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{2}:\d{2}(:\d{2})?$/,
    /^[A-Z]{2,}$/,
    /^#[0-9a-fA-F]{3,8}$/,
    /^rgb\(/,
    /^rgba\(/,
    /^\d+(\.\d+)?px$/,
    /^\d+(\.\d+)?%$/,
    /^\d+(\.\d+)?em$/,
    /^\d+(\.\d+)?rem$/,
  ],

  /** Vue directive / event name prefixes */
  eventNames: [
    /^on[A-Z]/,
    /^@[a-z]/,
    /^v-[a-z]/,
    /^:[a-z]/,
  ],

  /** MIME types */
  mimeTypes: [/^(application|text|image|video|audio)\//, /^multipart\//],

  /** HTTP methods and status codes */
  httpTechnical: [/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/, /^\d{3}$/],
}

/**
 * Content-based categorization patterns used to label detected strings.
 */
export const categorizationPatterns = {
  button: [
    /\b(save|cancel|submit|delete|edit|create|update|add|remove|close|confirm|ok|yes|no)\b/i,
    /<button/i,
    /@click/i,
  ],

  error: [
    /\b(error|failed|failure|invalid|incorrect|wrong)\b/i,
    /toast\.error/i,
    /notification\.error/i,
  ],

  notification: [
    /toast\./i,
    /notification\./i,
    /\b(success|successfully|completed|saved|deleted|updated|created)\b/i,
  ],

  message: [/\b(message|info|warning|alert|notice)\b/i],

  label: [/<label/i, /\bfor\s*=/i],
}

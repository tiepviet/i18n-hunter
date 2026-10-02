import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readTextFileBounded } from './bounded-read.js'
import { createScannerConfig } from './config.js'
import { HunterError, safeMessage } from './errors.js'
import { discoverSourceFiles } from './discovery.js'
import { generateSmartKey, shortHash } from './key-generator.js'
import { resolveScanLimits } from './limits.js'
import { canonicalizeRoot, isVueSourcePath, resolveContainedSourcePath } from './path-policy.js'
import { parseReactSource } from './react-parser.js'
import { ExtractionReportSchema } from './report-schema.js'
import { hashText } from './source-range.js'
import {
  findingCategories,
  type Diagnostic,
  type ExtractionReport,
  type ExtractedCandidate,
  type FindingCategory,
  type ScanResult,
  type ScannerConfig,
} from './types.js'
import { parseVueSource } from './vue-parser.js'

export async function scanForHardcodedStrings(
  userConfig: Partial<ScannerConfig> = {},
  basePath: string = process.cwd(),
): Promise<ExtractionReport> {
  const config = createScannerConfig(userConfig)
  const root = canonicalizeRoot(basePath)
  const limits = resolveScanLimits(config.limits)
  const discovery = discoverSourceFiles(root, {
    scanPaths: config.scanPaths,
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    limits,
    ...(config.stateDir ? { stateDir: config.stateDir } : {}),
  })
  const diagnostics: Diagnostic[] = [...discovery.diagnostics]
  const findings: ScanResult[] = []
  const usedKeys = new Map<string, string>()
  let filesScanned = 0
  let totalBytes = 0

  for (const filePath of discovery.files) {
    const resolved = resolveContainedSourcePath(root, filePath)
    let content: string
    try {
      content = readTextFileBounded(resolved.path, limits.maxFileBytes)
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code:
          error instanceof Error && 'code' in error && error.code === 'E_FILE_LIMIT'
            ? 'E_FILE_LIMIT'
            : 'E_IO',
        message:
          error instanceof Error && 'code' in error && error.code === 'E_FILE_LIMIT'
            ? `File exceeds maxFileBytes (${limits.maxFileBytes})`
            : 'Unable to read source file',
        filePath,
      })
      continue
    }
    const size = Buffer.byteLength(content, 'utf8')
    if (totalBytes + size > limits.maxTotalBytes) {
      diagnostics.push({
        severity: 'error',
        code: 'E_FILE_LIMIT',
        message: 'Maximum total scan bytes exceeded',
        filePath,
      })
      break
    }

    totalBytes += size
    const isVue = isVueSourcePath(filePath)
    const result = isVue
      ? await parseVueSource(content, filePath)
      : parseReactSource(content, filePath)

    diagnostics.push(...result.diagnostics)
    if (result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) continue
    filesScanned += 1

    const fileHash = hashText(content)
    for (const candidate of result.candidates) {
      if (!isTransformableCandidate(candidate, isVue)) {
        diagnostics.push({
          severity: 'error',
          code: 'E_UNSUPPORTED_TRANSFORM',
          message: `Finding requires manual component-aware translation: ${filePath}:${candidate.lineNumber}`,
          filePath,
          lineNumber: candidate.lineNumber,
          columnNumber: candidate.columnNumber,
        })
      }
      if (findings.length >= limits.maxFindings) {
        diagnostics.push({
          severity: 'error',
          code: 'E_FILE_LIMIT',
          message: `Maximum finding count exceeded (${limits.maxFindings})`,
          filePath,
        })
        return createReport(
          config,
          limits,
          discovery.files.length,
          filesScanned,
          findings,
          diagnostics,
        )
      }
      findings.push(
        createFinding(
          candidate,
          filePath,
          content,
          fileHash,
          config.includeValues === true,
          config.readableKeys === true,
          usedKeys,
        ),
      )
    }
  }

  return createReport(config, limits, discovery.files.length, filesScanned, findings, diagnostics)
}

function isTransformableCandidate(candidate: ExtractedCandidate, isVue: boolean): boolean {
  if (isVue && candidate.transform.startsWith('vue-template-')) return true
  return (
    candidate.component?.kind === 'react-function' ||
    candidate.component?.kind === 'vue-script-setup'
  )
}

function createFinding(
  candidate: ExtractedCandidate,
  filePath: string,
  content: string,
  fileHash: string,
  includeValue: boolean,
  readableKeys: boolean,
  usedKeys: Map<string, string>,
): ScanResult {
  const raw = content.slice(candidate.range.start, candidate.range.end)
  const valueHash = includeValue ? hashText(candidate.value) : undefined
  const baseKey = readableKeys
    ? generateSmartKey(candidate.value, scopeFromFile(filePath), candidate.category)
    : `${sanitizeScope(scopeFromFile(filePath))}.${categorySegment(candidate.category)}.u_${randomBytes(10).toString('hex')}`
  const existingValue = usedKeys.get(baseKey)
  let suggestedKey = baseKey
  if (existingValue !== undefined && existingValue !== candidate.value) {
    // Re-probe each suffix: `shortHash` is only 8 hex characters, so the first
    // collision candidate cannot be assumed unique.
    const suffix = shortHash(valueHash ?? raw)
    let attempt = 1
    while (usedKeys.has(suggestedKey) && usedKeys.get(suggestedKey) !== candidate.value) {
      suggestedKey = `${baseKey}_${suffix}_${attempt}`
      attempt += 1
    }
  }
  usedKeys.set(suggestedKey, candidate.value)

  return {
    id: `finding-${hashText(`${filePath}:${candidate.range.start}:${candidate.range.end}:${raw}`)}`,
    filePath,
    fileSha256: fileHash,
    sliceSha256: hashText(raw),
    valueSha256: valueHash,
    hardcodedString: includeValue ? candidate.value : undefined,
    lineNumber: candidate.lineNumber,
    columnNumber: candidate.columnNumber,
    endLineNumber: candidate.endLineNumber,
    endColumnNumber: candidate.endColumnNumber,
    suggestedKey,
    context: candidate.context,
    category: candidate.category,
    transform: candidate.transform,
    range: candidate.range,
    component: candidate.component,
    isNotification: candidate.isNotification,
    notificationType: candidate.notificationType,
  }
}

function createReport(
  config: ScannerConfig,
  limits: ReturnType<typeof resolveScanLimits>,
  filesDiscovered: number,
  filesScanned: number,
  findings: ScanResult[],
  diagnostics: Diagnostic[],
): ExtractionReport {
  findings.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) || left.range.start - right.range.start,
  )
  let boundedDiagnostics = boundDiagnostics(diagnostics)
  const buildReport = (): unknown => {
    const categories = Object.fromEntries(
      findingCategories.map((category) => [category, 0]),
    ) as Record<FindingCategory, number>
    for (const finding of findings) categories[finding.category] += 1
    const diagnosticCounts = { error: 0, warning: 0, info: 0 }
    for (const diagnostic of boundedDiagnostics) diagnosticCounts[diagnostic.severity] += 1

    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      complete: boundedDiagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
      scan: {
        paths: config.scanPaths,
        includePatterns: config.includePatterns,
        excludePatterns: config.excludePatterns,
        limits,
      },
      summary: {
        filesDiscovered,
        filesScanned,
        findings: findings.length,
        categories,
        diagnostics: diagnosticCounts,
      },
      findings,
      diagnostics: boundedDiagnostics,
    }
  }

  let report = buildReport()
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 20_000_000) {
    boundedDiagnostics = boundDiagnostics([
      ...boundedDiagnostics,
      {
        severity: 'error',
        code: 'E_FILE_LIMIT',
        message: 'Serialized report exceeds the 20 MB safety limit',
      },
    ])
    report = buildReport()
  }
  try {
    return ExtractionReportSchema.parse(report)
  } catch (error) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Scanner produced an invalid report: ${safeMessage(error)}`,
    )
  }
}

function boundDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  if (diagnostics.length <= 1000) return diagnostics
  return [
    ...diagnostics.slice(0, 999),
    {
      severity: 'error',
      code: 'E_FILE_LIMIT',
      message: `Diagnostic limit exceeded: ${diagnostics.length - 999} entries omitted`,
    },
  ]
}

function sanitizeScope(scope: string): string {
  const normalized = scope.replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '') || 'common'
  return normalized.length <= 48
    ? normalized
    : `${normalized.slice(0, 39)}__${shortHash(normalized)}`
}

function categorySegment(category: FindingCategory): string {
  return { label: 'lbl', button: 'btn', message: 'msg', error: 'error', notification: 'notify' }[
    category
  ]
}

function scopeFromFile(filePath: string): string {
  const withoutExtension = filePath.replace(/\.[^.]+$/u, '')
  const segments = withoutExtension.split('/').filter(Boolean)
  const fileName = segments.pop() ?? 'common'
  if (!/^(?:index|app)$/iu.test(fileName) && segments.length >= 0) {
    segments.push(fileName)
  } else if (segments.length === 0) {
    segments.push('common')
  }
  return segments.join('.').replace(/[^A-Za-z0-9_.-]+/gu, '_')
}

export function scanFileFingerprint(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function scanBasePath(path: string): string {
  return join(canonicalizeRoot(path))
}

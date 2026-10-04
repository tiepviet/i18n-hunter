import { parseExpression, parse } from '@babel/parser'
import * as t from '@babel/types'
import { generate } from './babel-compat.js'
import { HunterError, safeMessage } from './errors.js'
import { planReactBindings } from './inject-react.js'
import { planVueBindings } from './inject-vue.js'
import { parserPlugins } from './javascript-extractor.js'
import { isJsxSourcePath, isTypeScriptSourcePath, isVueSourcePath } from './path-policy.js'
import { verifyReportStructure } from './report-verification.js'
import { hashText } from './source-range.js'
import { applyTextEdits, validateFindingsAgainstSource, type TextEdit } from './text-edit.js'
import type { Diagnostic, ScanResult } from './types.js'

export interface TransformPlan {
  content: string
  originalHash: string
  finalHash: string
  changed: boolean
  edits: TextEdit[]
  diagnostics: Diagnostic[]
}

export async function createFileTransformPlan(
  content: string,
  filePath: string,
  findings: ScanResult[],
): Promise<TransformPlan> {
  validateFindingsAgainstSource(content, findings)
  await verifyReportStructure(content, filePath, findings)
  if (findings.length === 0) {
    return {
      content,
      originalHash: hashText(content),
      finalHash: hashText(content),
      changed: false,
      edits: [],
      diagnostics: [],
    }
  }

  const isVue = isVueSourcePath(filePath)
  const isTypeScript = isTypeScriptSourcePath(filePath)
  const bindingPlan = isVue
    ? planVueBindings(content, filePath, findings)
    : planReactBindings(content, filePath, findings)
  const edits = [...bindingPlan.edits]

  const unsupported: string[] = []
  for (const finding of findings) {
    try {
      const binding = bindingForFinding(finding, bindingPlan.bindings, isVue)
      edits.push({
        range: finding.range,
        replacement: replacementForFinding(
          finding,
          content,
          binding,
          isVue || isTypeScript,
          filePath,
        ),
        kind: 'finding',
        groupId: finding.component?.id ?? `template-${finding.range.start}`,
      })
    } catch (error) {
      if (error instanceof HunterError && error.code === 'E_UNSUPPORTED_TRANSFORM') {
        unsupported.push(`${finding.filePath}:${finding.lineNumber} (${finding.transform})`)
        continue
      }
      throw error
    }
  }
  if (unsupported.length > 0) {
    throw new HunterError(
      'E_UNSUPPORTED_TRANSFORM',
      `Finding(s) require manual component-aware translation (${unsupported.length}): ${unsupported.slice(0, 5).join('; ')}${unsupported.length > 5 ? `; …+${unsupported.length - 5} more` : ''}. Resolve them manually and regenerate the report.`,
      filePath,
    )
  }

  const transformed = applyTextEdits(content, edits)
  await validateTransformedSource(transformed, filePath, isTypeScript)
  return {
    content: transformed,
    originalHash: hashText(content),
    finalHash: hashText(transformed),
    changed: transformed !== content,
    edits,
    diagnostics: [],
  }
}

function bindingForFinding(
  finding: ScanResult,
  bindings: Map<string, string>,
  isVue: boolean,
): string | undefined {
  if (isVue && finding.transform.startsWith('vue-template-')) return undefined
  if (!finding.component) {
    throw new HunterError(
      'E_UNSUPPORTED_TRANSFORM',
      `Finding has no component scope and cannot be transformed safely: ${finding.filePath}:${finding.lineNumber}`,
      finding.filePath,
    )
  }
  const binding = bindings.get(finding.component.id)
  if (!binding) {
    throw new HunterError(
      'E_UNSUPPORTED_TRANSFORM',
      'No translation binding could be planned',
      finding.filePath,
    )
  }
  return binding
}

function replacementForFinding(
  finding: ScanResult,
  content: string,
  binding: string | undefined,
  typescript: boolean,
  filePath: string,
): string {
  const key = finding.suggestedKey
  switch (finding.transform) {
    case 'vue-template-text':
      return `{{ $t('${key}') }}`
    case 'vue-template-attribute': {
      // Interpolation and directive-inner ranges are bare string literals
      // (`{{ 'a' }}`, `v-text="'a'"`): always replace with a bare `$t`.
      // Only whole-attribute ranges (`placeholder="a"`) rewrite the attribute.
      // Branch on context first: `raw.includes('=')` misfires for values like 'a=b'.
      if (finding.context === 'interpolation:string' || finding.context === 'directive:v-text')
        return `$t('${key}')`
      const raw = content.slice(finding.range.start, finding.range.end)
      if (!raw.includes('=')) return `$t('${key}')`
      const parts = finding.context.split(':')
      if (parts.length !== 2) {
        throw new HunterError('E_REPORT_SCHEMA', 'Invalid Vue attribute context', finding.filePath)
      }
      const attribute = parts[1]
      if (!attribute || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(attribute)) {
        throw new HunterError('E_REPORT_SCHEMA', 'Invalid Vue attribute context', finding.filePath)
      }
      return `:${attribute}="$t('${key}')"`
    }
    case 'react-jsx-text':
      return `{${binding}('${key}')}`
    case 'react-jsx-attribute': {
      // Only inspect a small window before the range: the exact range exists,
      // so a full `slice(0, start)` scan violates the "never search by string" rule.
      const windowStart = Math.max(0, finding.range.start - 64)
      const before = content.slice(windowStart, finding.range.start).trimEnd()
      const expression = `${binding}('${key}')`
      return before.endsWith('=') ? `{${expression}}` : expression
    }
    case 'react-expression-string':
      return `${binding}('${key}')`
    case 'script-string':
      return `${binding}('${key}')`
    case 'script-template': {
      if (!binding)
        throw new HunterError(
          'E_UNSUPPORTED_TRANSFORM',
          'Template literal requires a binding',
          finding.filePath,
        )
      const raw = content.slice(finding.range.start, finding.range.end)
      const expression = parseExpression(raw, {
        plugins: parserPlugins({ typescript, jsx: isJsxSourcePath(filePath) }),
      })
      if (!t.isTemplateLiteral(expression)) {
        throw new HunterError('E_REPORT_SCHEMA', 'Expected a template literal', finding.filePath)
      }
      const interpolation = expression.expressions
        .map((item, index) => `${index}: ${generate(item).code}`)
        .join(', ')
      return `${binding}('${key}', { ${interpolation} })`
    }
    default:
      throw new HunterError(
        'E_UNSUPPORTED_TRANSFORM',
        `Unsupported transform kind: ${(finding as { transform: string }).transform}`,
        finding.filePath,
      )
  }
}

async function validateTransformedSource(
  content: string,
  filePath: string,
  isTypeScript: boolean,
): Promise<void> {
  if (isVueSourcePath(filePath)) {
    const [{ parse: parseSfc, compileScript, compileTemplate }, dom] = await Promise.all([
      import('@vue/compiler-sfc'),
      import('@vue/compiler-dom'),
    ])
    const parsed = parseSfc(content, { filename: filePath })
    if (parsed.errors.length > 0)
      throw new HunterError('E_PARSE_FAILED', 'Transformed Vue SFC does not parse', filePath)
    try {
      if (parsed.descriptor.scriptSetup)
        compileScript(parsed.descriptor, { id: 'i18n-hunter-validation' })
      if (parsed.descriptor.template) {
        const compiled = compileTemplate({
          source: parsed.descriptor.template.content,
          filename: filePath,
          id: 'i18n-hunter-validation',
        })
        if (compiled.errors.length > 0) throw new Error(compiled.errors.map(String).join('; '))
      }
      dom.parse(parsed.descriptor.template?.content ?? '', {
        onError: (error) => {
          throw error
        },
      })
    } catch (error) {
      throw new HunterError(
        'E_PARSE_FAILED',
        `Transformed Vue SFC is invalid: ${safeMessage(error)}`,
        filePath,
      )
    }
    return
  }

  try {
    parse(content, {
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      plugins: parserPlugins({
        typescript: isTypeScript,
        jsx: isJsxSourcePath(filePath),
      }),
    })
  } catch (error) {
    throw new HunterError(
      'E_PARSE_FAILED',
      `Transformed source is invalid: ${safeMessage(error)}`,
      filePath,
    )
  }
}

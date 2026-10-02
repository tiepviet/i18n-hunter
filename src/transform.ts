import { parseExpression, parse } from '@babel/parser'
import * as t from '@babel/types'
import { generate } from './babel-compat.js'
import { HunterError, safeMessage } from './errors.js'
import { planReactBindings } from './inject-react.js'
import { planVueBindings } from './inject-vue.js'
import { parserPlugins } from './javascript-extractor.js'
import { isVueSourcePath } from './path-policy.js'
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
  const isTypeScript =
    filePath.toLowerCase().endsWith('.ts') || filePath.toLowerCase().endsWith('.tsx') || isVue
  const bindingPlan = isVue
    ? planVueBindings(content, filePath, findings)
    : planReactBindings(content, filePath, findings)
  const edits = [...bindingPlan.edits]

  for (const finding of findings) {
    const binding = bindingForFinding(finding, bindingPlan.bindings, isVue)
    edits.push({
      range: finding.range,
      replacement: replacementForFinding(finding, content, binding, isVue || isTypeScript),
      kind: 'finding',
      groupId: finding.component?.id ?? `template-${finding.range.start}`,
    })
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
): string {
  const key = finding.suggestedKey
  switch (finding.transform) {
    case 'vue-template-text':
      return `{{ $t('${key}') }}`
    case 'vue-template-attribute': {
      const raw = content.slice(finding.range.start, finding.range.end)
      if (!raw.includes('=')) return `$t('${key}')`
      const attribute = finding.context.split(':')[1]
      if (!attribute || !/^[a-z][a-z0-9-]*$/u.test(attribute)) {
        throw new HunterError('E_REPORT_SCHEMA', 'Invalid Vue attribute context', finding.filePath)
      }
      return `:${attribute}="$t('${key}')"`
    }
    case 'react-jsx-text':
      return `{${binding}('${key}')}`
    case 'react-jsx-attribute': {
      const before = content.slice(0, finding.range.start).trimEnd()
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
        plugins: parserPlugins({ typescript, jsx: false }),
      })
      if (!t.isTemplateLiteral(expression)) {
        throw new HunterError('E_REPORT_SCHEMA', 'Expected a template literal', finding.filePath)
      }
      const interpolation = expression.expressions
        .map((item, index) => `${index}: ${generate(item).code}`)
        .join(', ')
      return `${binding}('${key}', { ${interpolation} })`
    }
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
        jsx: filePath.endsWith('.tsx') || filePath.endsWith('.jsx'),
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

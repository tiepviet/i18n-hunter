import { parseExpression } from '@babel/parser'
import {
  categoryForTag,
  isTechnicalValue,
  isVisibleText,
  normalizeAttributeName,
  userFacingAttributes,
} from './i18n-taxonomy.js'
import { safeMessage } from './errors.js'
import { parseJavaScriptSource } from './javascript-extractor.js'
import { createSourceIndex, trimRange, type SourceIndex } from './source-range.js'
import type {
  Diagnostic,
  ExtractedCandidate,
  FindingCategory,
  ParsedVueBlock,
  ParsedVueComponent,
  ParseResult,
} from './types.js'

interface VueCompiler {
  parseSfc: (typeof import('@vue/compiler-sfc'))['parse']
  parseTemplate: (typeof import('@vue/compiler-dom'))['parse']
  NodeTypes: (typeof import('@vue/compiler-dom'))['NodeTypes']
}

let compilerPromise: Promise<VueCompiler> | undefined

export function __resetVueCompilerForTests(): void {
  compilerPromise = undefined
}

export async function parseVueSource(content: string, filePath: string): Promise<ParseResult> {
  let compiler: VueCompiler
  try {
    compiler = await loadVueCompiler()
  } catch {
    return {
      candidates: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'E_INVALID_INPUT',
          message:
            'Vue scanning requires @vue/compiler-sfc and @vue/compiler-dom. Install the Vue peer dependencies.',
          filePath,
        },
      ],
    }
  }

  const diagnostics: Diagnostic[] = []
  let descriptor: ReturnType<VueCompiler['parseSfc']>['descriptor']
  try {
    const parsed = compiler.parseSfc(content, { filename: filePath })
    descriptor = parsed.descriptor
    if (parsed.errors.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'E_PARSE_FAILED',
        message: parsed.errors
          .map((error) => error.message)
          .join('; ')
          .slice(0, 1000),
        filePath,
      })
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'E_PARSE_FAILED',
      message: safeMessage(error),
      filePath,
    })
    return { candidates: [], diagnostics }
  }

  if (diagnostics.some((diagnostic) => diagnostic.code === 'E_PARSE_FAILED')) {
    return { candidates: [], diagnostics }
  }

  const candidates: ExtractedCandidate[] = []
  if (descriptor.template) {
    if (descriptor.template.src) {
      diagnostics.push({
        severity: 'error',
        code: 'E_UNSUPPORTED_TRANSFORM',
        message: `External Vue template blocks are not supported: ${descriptor.template.src}`,
        filePath,
      })
    } else {
      const lang = (descriptor.template.lang ?? 'html').toLowerCase()
      if (lang !== 'html' && lang !== '') {
        diagnostics.push({
          severity: 'error',
          code: 'E_PARSE_FAILED',
          message: `Unsupported Vue template language: ${descriptor.template.lang}`,
          filePath,
        })
      } else {
        candidates.push(
          ...extractTemplateCandidates(
            content,
            descriptor.template,
            filePath,
            compiler,
            diagnostics,
          ),
        )
      }
    }
  }

  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue
    if (block.src) {
      diagnostics.push({
        severity: 'error',
        code: 'E_UNSUPPORTED_TRANSFORM',
        message: `External Vue ${block.setup ? 'script setup' : 'script'} blocks are not supported: ${block.src}`,
        filePath,
      })
      continue
    }
    const lang = (block.lang ?? 'js').toLowerCase()
    const result = parseJavaScriptSource({
      content: block.content,
      fullSource: content,
      filePath,
      startOffset: block.loc.start.offset,
      typescript: lang === 'ts' || lang === 'tsx' || lang === 'mts' || lang === 'cts',
      jsx: lang === 'tsx' || lang === 'jsx',
      componentMode: block.setup ? 'vue-script-setup' : 'vue-script',
      componentName: componentNameFromFile(filePath),
    })
    candidates.push(...result.candidates)
    diagnostics.push(...result.diagnostics)
  }

  candidates.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  )
  return { candidates, diagnostics }
}

export async function parseVueComponent(
  content: string,
  filePath: string,
): Promise<ParsedVueComponent | null> {
  let compiler: VueCompiler
  try {
    compiler = await loadVueCompiler()
  } catch {
    return null
  }

  try {
    const parsed = compiler.parseSfc(content, { filename: filePath })
    const result: ParsedVueComponent = {
      filePath,
      errors: parsed.errors.map((error) => error.message),
    }
    if (parsed.descriptor.template) {
      result.template = toParsedBlock(
        parsed.descriptor.template.content,
        parsed.descriptor.template.loc.start.offset,
        parsed.descriptor.template.lang,
      )
    }
    if (parsed.descriptor.script) {
      result.script = toParsedBlock(
        parsed.descriptor.script.content,
        parsed.descriptor.script.loc.start.offset,
        parsed.descriptor.script.lang,
      )
    }
    if (parsed.descriptor.scriptSetup) {
      result.scriptSetup = toParsedBlock(
        parsed.descriptor.scriptSetup.content,
        parsed.descriptor.scriptSetup.loc.start.offset,
        parsed.descriptor.scriptSetup.lang,
        true,
      )
    }
    return result
  } catch {
    return null
  }
}

export async function extractTemplateStrings(
  template: string,
  startLine: number,
  filePath = 'Component.vue',
): Promise<Array<{ value: string; line: number; column: number; context: string }>> {
  const compiler = await loadVueCompiler()
  const diagnostics: Diagnostic[] = []
  return extractTemplateCandidates(
    template,
    { content: template, loc: { start: { offset: 0 } } },
    filePath,
    compiler,
    diagnostics,
  ).map((candidate) => ({
    value: candidate.value,
    line: startLine + candidate.lineNumber - 1,
    column: candidate.columnNumber,
    context: candidate.context,
  }))
}

function extractTemplateCandidates(
  fullSource: string,
  block: { content: string; loc: { start: { offset: number } } },
  filePath: string,
  compiler: VueCompiler,
  diagnostics: Diagnostic[],
): ExtractedCandidate[] {
  const templateErrors: string[] = []
  let ast
  try {
    ast = compiler.parseTemplate(block.content, {
      comments: false,
      onError: (error) => templateErrors.push(error.message),
    })
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'E_PARSE_FAILED',
      message: safeMessage(error),
      filePath,
    })
    return []
  }

  if (templateErrors.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'E_PARSE_FAILED',
      message: templateErrors.join('; ').slice(0, 1000),
      filePath,
    })
    return []
  }

  const results: ExtractedCandidate[] = []
  const lineIndex = createSourceIndex(fullSource)
  walkTemplate(
    ast,
    block.loc.start.offset,
    fullSource,
    filePath,
    null,
    compiler,
    results,
    diagnostics,
    lineIndex,
  )
  return results
}

function walkTemplate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  parentTag: string | null,
  compiler: VueCompiler,
  results: ExtractedCandidate[],
  diagnostics: Diagnostic[],
  lineIndex: SourceIndex,
): void {
  if (!node) return

  if (node.type === compiler.NodeTypes.TEXT) {
    addTextCandidate(node, blockStart, fullSource, filePath, parentTag, results, lineIndex)
    return
  }
  if (node.type === compiler.NodeTypes.INTERPOLATION) {
    addInterpolationCandidate(
      node,
      blockStart,
      fullSource,
      filePath,
      results,
      diagnostics,
      lineIndex,
    )
    return
  }

  if (node.type === compiler.NodeTypes.ELEMENT) {
    const tag = typeof node.tag === 'string' ? node.tag : null
    for (const property of node.props ?? []) {
      if (property.type === compiler.NodeTypes.ATTRIBUTE) {
        addAttributeCandidate(property, blockStart, fullSource, filePath, results, lineIndex)
      } else if (property.type === compiler.NodeTypes.DIRECTIVE) {
        addDirectiveCandidate(
          property,
          blockStart,
          fullSource,
          filePath,
          results,
          diagnostics,
          lineIndex,
        )
      }
    }
    for (const child of node.children ?? []) {
      walkTemplate(
        child,
        blockStart,
        fullSource,
        filePath,
        tag,
        compiler,
        results,
        diagnostics,
        lineIndex,
      )
    }
    return
  }

  for (const child of node.children ?? []) {
    walkTemplate(
      child,
      blockStart,
      fullSource,
      filePath,
      parentTag,
      compiler,
      results,
      diagnostics,
      lineIndex,
    )
  }
}

function addTextCandidate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  parentTag: string | null,
  results: ExtractedCandidate[],
  lineIndex: SourceIndex,
): void {
  const raw = node.loc?.source ?? ''
  // Vue decodes entities in `node.content` (`&amp;` → `&`) while `loc.source`
  // keeps the encoded source. Trim/range must use the raw source so
  // `fullSource.slice(range.start, range.end)` is the exact raw slice; only
  // `value` is the decoded text for translation keys/hashes.
  const trimmed = trimRange(raw)
  const value = (node.content ?? raw).trim()
  if (!trimmed || !isVisibleText(value)) return
  const range = {
    start: blockStart + node.loc.start.offset + trimmed.leading,
    end: blockStart + node.loc.start.offset + trimmed.leading + trimmed.value.length,
  }
  const context = parentTag ? `tag:${parentTag.toLowerCase()}` : 'text-node'
  results.push(
    createCandidate({
      value,
      raw: fullSource.slice(range.start, range.end),
      range,
      fullSource,
      lineIndex,
      filePath,
      context,
      category: categoryForTag(parentTag, value),
      transform: 'vue-template-text',
    }),
  )
}

function addInterpolationCandidate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  results: ExtractedCandidate[],
  diagnostics: Diagnostic[],
  lineIndex: SourceIndex,
): void {
  // `{{ 'hardcoded' }}` and `{{ cond ? 'a' : 'b' }}` contain extractable literals.
  const expressionSource: string | undefined = node.content?.loc?.source ?? node.content
  if (typeof expressionSource !== 'string' || !expressionSource) return
  let expression: any
  try {
    expression = parseExpression(expressionSource, {
      plugins: ['typescript'],
    })
  } catch (error) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: safeMessage(error),
      filePath,
    })
    return
  }
  const literals: Array<{ value: string; start: number; end: number }> = []
  const foundTemplateLiteral = collectStringLiterals(expression, literals)
  if (foundTemplateLiteral) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: 'Template literals need per-quasi mapping',
      filePath,
    })
  }
  const baseOffset: number | undefined = node.content?.loc?.start?.offset
  if (baseOffset === undefined) return
  for (const literal of literals) {
    if (!isVisibleText(literal.value) || isTechnicalValue(literal.value)) continue
    const start = blockStart + baseOffset + literal.start
    const end = blockStart + baseOffset + literal.end
    results.push(
      createCandidate({
        value: literal.value,
        raw: fullSource.slice(start, end),
        range: { start, end },
        fullSource,
        lineIndex,
        filePath,
        context: 'interpolation:string',
        category: 'label',
        transform: 'vue-template-attribute',
      }),
    )
  }
}

function collectStringLiterals(
  node: any,
  out: Array<{ value: string; start: number; end: number }>,
): boolean {
  if (!node || typeof node !== 'object') return false
  if (
    node.type === 'StringLiteral' &&
    typeof node.start === 'number' &&
    typeof node.end === 'number'
  ) {
    out.push({ value: node.value, start: node.start, end: node.end })
    return false
  }
  if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
    // Template literals in `{{ }}` need per-quasi range mapping that
    // parseExpression offsets cannot provide safely. Skip with caller-visible
    // info instead of emitting wrong ranges.
    return true
  }
  let foundTemplate = false
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (collectStringLiterals(item, out)) foundTemplate = true
      }
    } else if (value && typeof value === 'object' && 'type' in (value as object)) {
      if (collectStringLiterals(value, out)) foundTemplate = true
    }
  }
  return foundTemplate
}

function addAttributeCandidate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  results: ExtractedCandidate[],
  lineIndex: SourceIndex,
): void {
  const rawName: string | undefined = typeof node.name === 'string' ? node.name : undefined
  const attributeName: string | undefined =
    rawName !== undefined ? normalizeAttributeName(rawName) : undefined
  if (!attributeName || !userFacingAttributes.has(attributeName) || !node.value?.loc) return
  const raw = node.value.loc.source as string
  const quote = raw[0]
  const valueRaw = quote === '"' || quote === "'" ? raw.slice(1, -1) : raw
  const value = typeof node.value.content === 'string' ? node.value.content : valueRaw
  if (!isVisibleText(value) || isTechnicalValue(value)) return
  const range = {
    start: blockStart + node.loc.start.offset,
    end: blockStart + node.loc.end.offset,
  }
  results.push(
    createCandidate({
      value,
      raw: fullSource.slice(range.start, range.end),
      range,
      fullSource,
      lineIndex,
      filePath,
      context: `attribute:${node.name}`,
      category: 'label',
      transform: 'vue-template-attribute',
    }),
  )
}

function addDirectiveCandidate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  results: ExtractedCandidate[],
  diagnostics: Diagnostic[],
  lineIndex: SourceIndex,
): void {
  const expressionSource = node.exp?.loc?.source
  if (!expressionSource) return
  // Only `v-text` and user-facing bound attributes (`:placeholder`, `:title`, …)
  // are safe to transform. Dynamic argument bindings (`:[key]`) and non-string
  // expressions are reported as info, never silently dropped.
  const directiveName: string = typeof node.name === 'string' ? node.name : ''
  if (directiveName !== 'bind' && directiveName !== 'text') {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: `Unsupported Vue directive: ${directiveName || 'unknown'}`,
      filePath,
    })
    return
  }
  let expression: any
  try {
    expression = parseExpression(expressionSource, {
      plugins: ['typescript'],
    })
  } catch (error) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: safeMessage(error),
      filePath,
    })
    return
  }
  if (expression.type !== 'StringLiteral') {
    if (
      expression.type === 'ConditionalExpression' ||
      expression.type === 'LogicalExpression' ||
      expression.type === 'SequenceExpression'
    ) {
      const rawArgument =
        typeof node.arg?.loc?.source === 'string' ? node.arg.loc.source.trim() : undefined
      const normalizedArgument =
        rawArgument !== undefined ? normalizeAttributeName(rawArgument) : undefined
      const isConditionalVText = directiveName === 'text'
      // Dynamic argument bindings like `v-bind:[dynamicKey]` have no static attribute name.
      if (node.arg?.isStatic === false) {
        diagnostics.push({
          severity: 'info',
          code: 'E_UNSUPPORTED_TRANSFORM',
          message: 'Unsupported dynamic Vue binding argument',
          filePath,
        })
        return
      }
      if (
        !isConditionalVText &&
        (!normalizedArgument || !userFacingAttributes.has(normalizedArgument))
      ) {
        diagnostics.push({
          severity: 'info',
          code: 'E_UNSUPPORTED_TRANSFORM',
          message: `Unsupported Vue bound attribute: ${normalizedArgument ?? 'dynamic'}`,
          filePath,
        })
        return
      }
      const literals: Array<{ value: string; start: number; end: number }> = []
      const foundTemplateLiteral = collectStringLiterals(expression, literals)
      if (foundTemplateLiteral) {
        diagnostics.push({
          severity: 'info',
          code: 'E_UNSUPPORTED_TRANSFORM',
          message: 'Template literals need per-quasi mapping',
          filePath,
        })
      }
      const baseOffset = blockStart + node.exp.loc.start.offset
      for (const literal of literals) {
        if (!isVisibleText(literal.value) || isTechnicalValue(literal.value)) continue
        const literalStart = baseOffset + literal.start
        const literalEnd = baseOffset + literal.end
        const literalContext = isConditionalVText
          ? 'directive:v-text'
          : rawArgument
            ? `attribute:${rawArgument}`
            : `directive:${node.name}`
        results.push(
          createCandidate({
            value: literal.value,
            raw: fullSource.slice(literalStart, literalEnd),
            range: { start: literalStart, end: literalEnd },
            fullSource,
            lineIndex,
            filePath,
            context: literalContext,
            category: 'label',
            transform: 'vue-template-attribute',
          }),
        )
      }
      return
    }
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: `Unsupported Vue bound expression: ${expression.type}`,
      filePath,
    })
    return
  }
  const start = blockStart + node.exp.loc.start.offset + expression.start
  const end = blockStart + node.exp.loc.start.offset + expression.end
  const value = expression.value
  if (!isVisibleText(value)) return
  const rawArgument =
    typeof node.arg?.loc?.source === 'string' ? node.arg.loc.source.trim() : undefined
  const argument = rawArgument !== undefined ? normalizeAttributeName(rawArgument) : undefined
  const isVText = directiveName === 'text'
  // Dynamic argument bindings like `v-bind:[dynamicKey]` have no static attribute name.
  if (node.arg?.isStatic === false) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: 'Unsupported dynamic Vue binding argument',
      filePath,
    })
    return
  }
  if (!isVText && (!argument || !userFacingAttributes.has(argument))) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: `Unsupported Vue bound attribute: ${argument ?? 'dynamic'}`,
      filePath,
    })
    return
  }
  if (isTechnicalValue(value)) return
  const context = isVText
    ? 'directive:v-text'
    : rawArgument
      ? `attribute:${rawArgument}`
      : `directive:${node.name}`
  results.push(
    createCandidate({
      value,
      raw: fullSource.slice(start, end),
      range: { start, end },
      fullSource,
      lineIndex,
      filePath,
      context,
      category: 'label',
      transform: 'vue-template-attribute',
    }),
  )
}

function createCandidate(input: {
  value: string
  raw: string
  range: { start: number; end: number }
  fullSource: string
  lineIndex: SourceIndex
  filePath: string
  context: string
  category: FindingCategory
  transform: 'vue-template-text' | 'vue-template-attribute'
}): ExtractedCandidate {
  const start = input.lineIndex.positionAt(input.range.start)
  const end = input.lineIndex.positionAt(input.range.end)
  return {
    value: input.value,
    raw: input.raw,
    range: input.range,
    lineNumber: start.line,
    columnNumber: start.column,
    endLineNumber: end.line,
    endColumnNumber: end.column,
    context: input.context,
    category: input.category,
    transform: input.transform,
  }
}

function toParsedBlock(
  content: string,
  start: number,
  lang?: string,
  setup = false,
): ParsedVueBlock {
  return { content, start, end: start + content.length, lang, setup }
}

function componentNameFromFile(filePath: string): string {
  const rawName =
    filePath
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? 'Component'
  // `my-component.vue` → `MyComponent`-style scope; fall back to sanitized name.
  const pascal = rawName
    .split(/[-_]+/u)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ''))
    .join('')
  const safe = /^[A-Za-z][A-Za-z0-9]*$/u.test(pascal) ? pascal : 'Component'
  return safe.slice(0, 100)
}

async function loadVueCompiler(): Promise<VueCompiler> {
  compilerPromise ??= Promise.all([import('@vue/compiler-sfc'), import('@vue/compiler-dom')])
    .then(([sfc, dom]) => ({
      parseSfc: sfc.parse,
      parseTemplate: dom.parse,
      NodeTypes: dom.NodeTypes,
    }))
    .catch((error: unknown) => {
      // A failed optional-peer import must not poison later scans (e.g. after install).
      compilerPromise = undefined
      throw error
    })
  return compilerPromise
}

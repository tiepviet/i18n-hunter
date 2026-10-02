import { parseExpression } from '@babel/parser'
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

const userFacingAttributes = new Set([
  'alt',
  'aria-label',
  'label',
  'placeholder',
  'title',
  'tooltip',
])
const buttonTags = new Set(['a', 'button', 'nuxt-link', 'router-link', 'el-button'])
const labelTags = new Set([
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
const messageTags = new Set(['blockquote', 'dd', 'figcaption', 'li', 'p', 'span', 'summary', 'td'])

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
    candidates.push(
      ...extractTemplateCandidates(content, descriptor.template, filePath, compiler, diagnostics),
    )
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
    const result = parseJavaScriptSource({
      content: block.content,
      fullSource: content,
      filePath,
      startOffset: block.loc.start.offset,
      typescript: block.lang === 'ts' || block.lang === 'tsx',
      jsx: block.lang === 'tsx' || block.lang === 'jsx',
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
  if (node.type === compiler.NodeTypes.INTERPOLATION) return

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
  const trimmed = trimRange(raw)
  const value = (node.content ?? raw).trim()
  if (!trimmed || !/[\p{L}\p{N}]/u.test(value)) return
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

function addAttributeCandidate(
  node: any,
  blockStart: number,
  fullSource: string,
  filePath: string,
  results: ExtractedCandidate[],
  lineIndex: SourceIndex,
): void {
  if (!userFacingAttributes.has(node.name) || !node.value?.loc) return
  const raw = node.value.loc.source as string
  const quote = raw[0]
  const valueRaw = quote === '"' || quote === "'" ? raw.slice(1, -1) : raw
  const value = typeof node.value.content === 'string' ? node.value.content : valueRaw
  if (!/[\p{L}\p{N}]/u.test(value) || isTechnicalTemplateValue(value)) return
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
  try {
    const expression = parseExpression(expressionSource, { plugins: ['typescript'] })
    if (expression.type !== 'StringLiteral') return
    const start = blockStart + node.exp.loc.start.offset + expression.start
    const end = blockStart + node.exp.loc.start.offset + expression.end
    const value = expression.value
    if (!/[\p{L}\p{N}]/u.test(value)) return
    const directiveSource = fullSource.slice(
      blockStart + node.loc.start.offset,
      blockStart + node.loc.end.offset,
    )
    const argument =
      typeof node.arg?.loc?.source === 'string' ? node.arg.loc.source.trim() : undefined
    const isVText = directiveSource.includes('v-text')
    if (!isVText && (!argument || !userFacingAttributes.has(argument))) return
    if (isTechnicalTemplateValue(value)) return
    const context = isVText
      ? 'directive:v-text'
      : argument
        ? `attribute:${argument}`
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
  } catch (error) {
    diagnostics.push({
      severity: 'info',
      code: 'E_UNSUPPORTED_TRANSFORM',
      message: safeMessage(error),
      filePath,
    })
  }
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

function categoryForTag(tag: string | null, value: string): FindingCategory {
  if (!tag) return 'message'
  const normalized = tag.toLowerCase()
  if (buttonTags.has(normalized) || buttonTags.has(tag)) return 'button'
  if (labelTags.has(normalized)) return 'label'
  if (messageTags.has(normalized)) return 'message'
  if (/(error|failed|invalid)/iu.test(value)) return 'error'
  return 'label'
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
  const name =
    filePath
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? 'Component'
  const safe = /^[A-Z]/u.test(name) ? name : 'Component'
  return safe.slice(0, 100)
}

function isTechnicalTemplateValue(value: string): boolean {
  return /^(?:https?:\/\/|data:|application\/|text\/|\/|\.{0,2}\/|[A-Za-z]:\\)/iu.test(value.trim())
}

async function loadVueCompiler(): Promise<VueCompiler> {
  compilerPromise ??= Promise.all([import('@vue/compiler-sfc'), import('@vue/compiler-dom')]).then(
    ([sfc, dom]) => ({
      parseSfc: sfc.parse,
      parseTemplate: dom.parse,
      NodeTypes: dom.NodeTypes,
    }),
  )
  return compilerPromise
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000)
}

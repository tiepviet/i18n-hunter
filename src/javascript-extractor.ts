import { parse, type ParserPlugin } from '@babel/parser'
import { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { generate, traverse } from './babel-compat.js'
import { createSourceIndex, positionAt, trimRange, type SourceIndex } from './source-range.js'
import type {
  ComponentContext,
  ExtractedCandidate,
  FindingCategory,
  NotificationType,
  ParseResult,
  TransformKind,
} from './types.js'

export interface JavaScriptExtractionOptions {
  content: string
  fullSource: string
  filePath: string
  startOffset?: number
  typescript?: boolean
  jsx?: boolean
  componentMode?: 'react' | 'vue-script-setup' | 'vue-script' | 'none'
  componentName?: string
  lineIndex?: SourceIndex
}

const userFacingAttributes = new Set([
  'alt',
  'aria-label',
  'label',
  'placeholder',
  'title',
  'tooltip',
])

const userFacingVariableNames = new Set([
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

const notificationCallees = new Set(['toast', 'notify', 'notification'])
const technicalCallees = new Set([
  'console',
  'fetch',
  'localStorage',
  'querySelector',
  'require',
  'sessionStorage',
  'setItem',
  'window.location',
])
const translationModules = new Set(['i18next', 'react-i18next', 'vue-i18n'])
const buttonTags = new Set(['a', 'button', 'Button', 'Link', 'NavLink', 'RouterLink'])
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
const messageTags = new Set(['dd', 'figcaption', 'li', 'p', 'span', 'summary', 'td'])

export function parseJavaScriptSource(options: JavaScriptExtractionOptions): ParseResult {
  const startOffset = options.startOffset ?? 0
  const extractionOptions: JavaScriptExtractionOptions = {
    ...options,
    lineIndex: options.lineIndex ?? createSourceIndex(options.fullSource),
  }
  const plugins = parserPlugins(extractionOptions)
  let ast: t.File

  try {
    ast = parse(extractionOptions.content, {
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: extractionOptions.componentMode === 'vue-script',
      allowSuperOutsideMethod: extractionOptions.componentMode === 'vue-script',
      errorRecovery: false,
      plugins,
    })
  } catch (error) {
    return {
      candidates: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'E_PARSE_FAILED',
          message: safeParseMessage(error),
          filePath: extractionOptions.filePath,
        },
      ],
    }
  }

  const candidates: ExtractedCandidate[] = []
  const componentMap = new Map<t.Node, ComponentContext>()
  collectReactComponents(ast, startOffset, componentMap, extractionOptions.content)
  const hasKnownTranslationBinding = detectTranslationBinding(ast.program)
  const vueComponent = createVueComponentContext(
    extractionOptions,
    startOffset,
    extractionOptions.content.length,
  )

  traverse(ast, {
    JSXText(path) {
      const candidate = createJsxTextCandidate(path, extractionOptions, startOffset, componentMap)
      if (candidate) candidates.push(candidate)
    },

    StringLiteral(path) {
      const candidate = createStringLiteralCandidate(
        path,
        extractionOptions,
        startOffset,
        componentMap,
        vueComponent,
        hasKnownTranslationBinding,
      )
      if (candidate) candidates.push(candidate)
    },

    TemplateLiteral(path) {
      const candidate = createTemplateLiteralCandidate(
        path,
        extractionOptions,
        startOffset,
        componentMap,
        vueComponent,
        hasKnownTranslationBinding,
      )
      if (candidate) candidates.push(candidate)
    },
  })

  candidates.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  )
  return { candidates, diagnostics: [] }
}

export function parserPlugins(
  options: Pick<JavaScriptExtractionOptions, 'typescript' | 'jsx'>,
): ParserPlugin[] {
  const plugins: ParserPlugin[] = [
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'dynamicImport',
    'explicitResourceManagement',
    'importAttributes',
    'importMeta',
    'nullishCoalescingOperator',
    'optionalChaining',
    'topLevelAwait',
  ]
  if (options.jsx) plugins.push('jsx')
  if (options.typescript) plugins.push('typescript')
  return plugins
}

function createStringLiteralCandidate(
  path: NodePath<t.StringLiteral>,
  options: JavaScriptExtractionOptions,
  startOffset: number,
  componentMap: Map<t.Node, ComponentContext>,
  vueComponent: ComponentContext | undefined,
  hasKnownTranslationBinding: boolean,
): ExtractedCandidate | undefined {
  const node = path.node
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return undefined
  if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration())
    return undefined
  if (path.parentPath.isTSTypeAnnotation() || path.parentPath.isTSLiteralType()) return undefined
  if (path.parentPath.isObjectProperty({ computed: false }) && path.key === 'key') return undefined

  const jsxAttribute = path.findParent((parent) => parent.isJSXAttribute())
  if (jsxAttribute?.isJSXAttribute()) {
    if (!t.isJSXIdentifier(jsxAttribute.node.name)) return undefined
    const attributeName = jsxAttribute.node.name.name
    if (!userFacingAttributes.has(attributeName)) return undefined
    return createCandidate({
      node,
      value: node.value,
      raw: options.content.slice(node.start, node.end),
      options,
      startOffset,
      context: `attribute:${attributeName}`,
      category: 'label',
      transform: 'react-jsx-attribute',
      component: findComponent(path, componentMap, vueComponent),
    })
  }

  const call = path.findParent((parent) => parent.isCallExpression())
  if (call?.isCallExpression() && isTranslationCall(call, hasKnownTranslationBinding))
    return undefined

  const notification = call?.isCallExpression() ? getNotificationType(call.node.callee) : null
  const variable = userFacingVariableFromPath(path)
  const technicalContext = call?.isCallExpression() ? isTechnicalCallee(call.node.callee) : false
  if (technicalContext) return undefined

  const context = notification
    ? `notification:${notification}`
    : variable
      ? `variable:${variable}`
      : call?.isCallExpression()
        ? `call:${calleeName(call.node.callee).toLowerCase()}`
        : 'script'
  const isUserFacing = Boolean(notification || variable || isReturnString(path))
  if (!isUserFacing || !isVisibleText(node.value)) return undefined

  return createCandidate({
    node,
    value: node.value,
    raw: options.content.slice(node.start, node.end),
    options,
    startOffset,
    context,
    category: categoryForContext(context, node.value),
    transform: 'script-string',
    component: findComponent(path, componentMap, vueComponent),
    isNotification: Boolean(notification),
    notificationType: notification ?? undefined,
  })
}

function createTemplateLiteralCandidate(
  path: NodePath<t.TemplateLiteral>,
  options: JavaScriptExtractionOptions,
  startOffset: number,
  componentMap: Map<t.Node, ComponentContext>,
  vueComponent: ComponentContext | undefined,
  hasKnownTranslationBinding: boolean,
): ExtractedCandidate | undefined {
  const node = path.node
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return undefined
  if (path.parentPath.isTaggedTemplateExpression()) return undefined
  const raw = options.content.slice(node.start, node.end)
  const value = renderTemplateLiteral(node)
  if (!isVisibleText(value) || isTechnicalValue(value)) return undefined

  const call = path.findParent((parent) => parent.isCallExpression())
  if (call?.isCallExpression() && isTranslationCall(call, hasKnownTranslationBinding))
    return undefined
  if (call?.isCallExpression() && isTechnicalCallee(call.node.callee)) return undefined
  const notification = call?.isCallExpression() ? getNotificationType(call.node.callee) : null
  const variable = userFacingVariableFromPath(path)
  const jsxExpression = path.findParent((parent) => parent.isJSXExpressionContainer()) !== null
  if (!notification && !variable && !jsxExpression && !isReturnString(path)) return undefined
  const context = notification
    ? `notification:${notification}`
    : variable
      ? `variable:${variable.toLowerCase()}`
      : jsxExpression
        ? 'jsx-expression'
        : 'script-template'

  return createCandidate({
    node,
    value,
    raw,
    options,
    startOffset,
    context,
    category: notification ? 'notification' : categoryForContext(context, value),
    transform: node.expressions.length === 0 ? 'script-string' : 'script-template',
    component: findComponent(path, componentMap, vueComponent),
    isNotification: Boolean(notification),
    notificationType: notification ?? undefined,
  })
}

function createJsxTextCandidate(
  path: NodePath<t.JSXText>,
  options: JavaScriptExtractionOptions,
  startOffset: number,
  componentMap: Map<t.Node, ComponentContext>,
): ExtractedCandidate | undefined {
  const node = path.node
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return undefined
  const value = node.value.trim()
  if (!isVisibleText(value)) return undefined

  const trimmed = trimRange(options.content.slice(node.start, node.end))
  if (!trimmed) return undefined
  const jsxElement = path.findParent((parent) => parent.isJSXElement())
  const tag = jsxElement?.isJSXElement() ? jsxTagName(jsxElement.node.openingElement) : null
  const context = tag ? `tag:${tag.toLowerCase()}` : 'jsx-text'

  return createCandidate({
    node: {
      start: startOffset + node.start + trimmed.leading,
      end: startOffset + node.start + trimmed.leading + trimmed.value.length,
    } as t.Node,
    value,
    raw: trimmed.value,
    options,
    startOffset: 0,
    context,
    category: categoryForContext(context, value),
    transform: 'react-jsx-text',
    component: findComponent(path, componentMap),
  })
}

function createCandidate(input: {
  node: Pick<t.Node, 'start' | 'end'>
  value: string
  raw: string
  options: JavaScriptExtractionOptions
  startOffset: number
  context: string
  category: FindingCategory
  transform: TransformKind
  component?: ComponentContext
  isNotification?: boolean
  notificationType?: NotificationType
}): ExtractedCandidate | undefined {
  if (
    typeof input.node.start !== 'number' ||
    typeof input.node.end !== 'number' ||
    !isVisibleText(input.value)
  )
    return undefined
  const range = {
    start: input.startOffset + input.node.start,
    end: input.startOffset + input.node.end,
  }
  const start = input.options.lineIndex
    ? input.options.lineIndex.positionAt(range.start)
    : positionAt(input.options.fullSource, range.start)
  const end = input.options.lineIndex
    ? input.options.lineIndex.positionAt(range.end)
    : positionAt(input.options.fullSource, range.end)

  return {
    value: input.value,
    raw: input.raw,
    range,
    lineNumber: start.line,
    columnNumber: start.column,
    endLineNumber: end.line,
    endColumnNumber: end.column,
    context: input.context,
    category: input.category,
    transform: input.transform,
    component: input.component,
    isNotification: input.isNotification,
    notificationType: input.notificationType,
  }
}

function collectReactComponents(
  ast: t.File,
  startOffset: number,
  componentMap: Map<t.Node, ComponentContext>,
  content: string,
): void {
  const jsxFunctions = new Set<t.Node>()
  const markNearestFunction = (path: NodePath): void => {
    let current: NodePath | null = path.parentPath
    while (current && !current.isFunction()) current = current.parentPath
    if (current?.isFunction()) jsxFunctions.add(current.node)
  }
  traverse(ast, {
    JSXElement: markNearestFunction,
    JSXFragment: markNearestFunction,
  })

  const register = (node: t.Function, name: string) => {
    if (
      !jsxFunctions.has(node) ||
      !/^[A-Z]/.test(name) ||
      typeof node.start !== 'number' ||
      typeof node.end !== 'number'
    )
      return
    const isBlock = t.isBlockStatement(node.body)
    const isExpressionBody = t.isArrowFunctionExpression(node) && !isBlock
    if (!isBlock && !isExpressionBody) return
    const bodyStart = node.body.start ?? node.start
    const parenthesizedStart = node.body.extra?.parenStart
    const expressionStart =
      isExpressionBody && typeof parenthesizedStart === 'number' ? parenthesizedStart : bodyStart
    const expressionEnd =
      isExpressionBody && typeof parenthesizedStart === 'number'
        ? (findClosingParenEnd(content, parenthesizedStart) ?? node.body.end ?? node.end)
        : (node.body.end ?? node.end)
    const context: ComponentContext = {
      id: `react-${name}-${startOffset + node.start}`,
      name,
      start: startOffset + node.start,
      end: startOffset + node.end,
      bodyStart: startOffset + (isBlock ? bodyStart + 1 : bodyStart),
      expressionBody: isExpressionBody,
      expressionStart: isExpressionBody ? startOffset + expressionStart : undefined,
      expressionEnd: isExpressionBody ? startOffset + expressionEnd : undefined,
      kind: 'react-function',
    }
    componentMap.set(node, context)
  }

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id) register(path.node, path.node.id.name)
    },
    VariableDeclarator(path) {
      const { id, init } = path.node
      if (!t.isIdentifier(id) || !init) return
      if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) register(init, id.name)
    },
    ExportDefaultDeclaration(path) {
      const declaration = path.node.declaration
      if (t.isFunctionDeclaration(declaration)) {
        register(declaration, declaration.id?.name ?? 'Default')
      }
    },
  })
}

function findClosingParenEnd(content: string, start: number): number | undefined {
  if (content[start] !== '(') return undefined
  let depth = 0
  let quote: '"' | "'" | '`' | undefined
  let lineComment = false
  let blockComment = false
  for (let index = start; index < content.length; index += 1) {
    const character = content[index]
    const next = content[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return undefined
}

function createVueComponentContext(
  options: JavaScriptExtractionOptions,
  startOffset: number,
  length: number,
): ComponentContext | undefined {
  if (options.componentMode !== 'vue-script-setup' && options.componentMode !== 'vue-script')
    return undefined
  const name = options.componentName ?? 'Component'
  return {
    id: `vue-${options.componentMode}-${startOffset}`,
    name,
    start: startOffset,
    end: startOffset + length,
    bodyStart: startOffset,
    kind: options.componentMode === 'vue-script-setup' ? 'vue-script-setup' : 'vue-options',
  }
}

function findComponent(
  path: NodePath,
  componentMap: Map<t.Node, ComponentContext>,
  fallback?: ComponentContext,
): ComponentContext | undefined {
  let current: NodePath | null = path
  while (current) {
    const component = componentMap.get(current.node)
    if (component) return component
    current = current.parentPath
  }
  return fallback
}

function detectTranslationBinding(program: t.Program): boolean {
  for (const statement of program.body) {
    if (!t.isImportDeclaration(statement) || !t.isStringLiteral(statement.source)) continue
    if (translationModules.has(statement.source.value)) return true
  }
  return false
}

function isTranslationCall(
  path: NodePath<t.CallExpression>,
  hasKnownTranslationBinding: boolean,
): boolean {
  const callee = calleeName(path.node.callee)
  if (
    callee === '$t' ||
    callee === 'i18n.t' ||
    callee === 'formatMessage' ||
    callee === 'intl.formatMessage'
  )
    return true
  return (
    callee === 't' ||
    callee === 'tc' ||
    callee === 'te' ||
    (hasKnownTranslationBinding && callee.endsWith('.t'))
  )
}

function getNotificationType(
  callee: t.Expression | t.V8IntrinsicIdentifier,
): NotificationType | null {
  const name = calleeName(callee)
  const parts = name.split('.')
  if (parts.length < 2 || !notificationCallees.has(parts[0]!)) return null
  const method = parts.at(-1)!.toLowerCase()
  if (method === 'success') return 'success'
  if (method === 'error') return 'error'
  if (method === 'info') return 'info'
  if (method === 'warn' || method === 'warning') return 'warning'
  return null
}

function isTechnicalCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  const name = calleeName(callee)
  return technicalCallees.has(name) || technicalCallees.has(name.split('.')[0]!)
}

function userFacingVariableFromPath(path: NodePath<t.Node>): string | undefined {
  const parent = path.parentPath
  if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
    return userFacingVariableNames.has(parent.node.id.name) ? parent.node.id.name : undefined
  }
  if (parent?.isAssignmentExpression() && t.isIdentifier(parent.node.left)) {
    return userFacingVariableNames.has(parent.node.left.name) ? parent.node.left.name : undefined
  }
  if (parent?.isObjectProperty() && t.isIdentifier(parent.node.key) && !parent.node.computed) {
    return userFacingVariableNames.has(parent.node.key.name) ? parent.node.key.name : undefined
  }
  return undefined
}

function isReturnString(path: NodePath<t.Node>): boolean {
  return path.findParent((parent) => parent.isReturnStatement()) !== null
}

function isTechnicalValue(value: string): boolean {
  return (
    /^(?:https?:\/\/|data:|application\/|text\/|\/|\.{0,2}\/|[A-Za-z]:\\)/iu.test(value.trim()) ||
    /^[a-z0-9_-]+(?:[./_-][a-z0-9_-]+)+$/iu.test(value.trim())
  )
}

function isVisibleText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value)
}

function categoryForContext(context: string, value: string): FindingCategory {
  if (context.startsWith('notification:')) return 'notification'
  const tag = context.startsWith('tag:') ? context.slice(4) : ''
  if (context.startsWith('tag:') && (buttonTags.has(tag) || buttonTags.has(tag.toLowerCase())))
    return 'button'
  if (context.startsWith('tag:') && (labelTags.has(tag) || labelTags.has(tag.toLowerCase())))
    return 'label'
  if (context.startsWith('tag:') && (messageTags.has(tag) || messageTags.has(tag.toLowerCase())))
    return 'message'
  if (/(error|failed|invalid|incorrect|wrong)/iu.test(value)) return 'error'
  if (context.includes('error')) return 'error'
  if (value.length > 30) return 'message'
  return 'label'
}

function jsxTagName(element: t.JSXOpeningElement): string {
  if (t.isJSXIdentifier(element.name)) return element.name.name
  if (t.isJSXMemberExpression(element.name)) {
    return `${jsxTagName({ ...element, name: element.name.object } as t.JSXOpeningElement)}.${element.name.property.name}`
  }
  return 'Unknown'
}

function calleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string {
  if (t.isIdentifier(callee)) return callee.name
  if (t.isMemberExpression(callee) && !callee.computed) {
    const object = t.isIdentifier(callee.object)
      ? callee.object.name
      : calleeName(callee.object as t.Expression)
    const property = t.isIdentifier(callee.property) ? callee.property.name : ''
    return `${object}.${property}`
  }
  if (t.isOptionalMemberExpression(callee) && !callee.computed) {
    const object = t.isIdentifier(callee.object)
      ? callee.object.name
      : calleeName(callee.object as t.Expression)
    const property = t.isIdentifier(callee.property) ? callee.property.name : ''
    return `${object}.${property}`
  }
  return ''
}

function renderTemplateLiteral(node: t.TemplateLiteral): string {
  let value = ''
  for (let index = 0; index < node.quasis.length; index += 1) {
    value += node.quasis[index]!.value.cooked ?? node.quasis[index]!.value.raw
    const expression = node.expressions[index]
    if (expression) value += `\${${generate(expression).code}}`
  }
  return value
}

function safeParseMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+at\s+.*/su, '').slice(0, 500)
}

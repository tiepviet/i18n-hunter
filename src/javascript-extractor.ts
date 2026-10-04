import { parse, type ParserPlugin } from '@babel/parser'
import { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { generate, traverse } from './babel-compat.js'
import {
  categoryForContext,
  isTechnicalValue,
  isVisibleText,
  normalizeAttributeName,
  notificationCallees,
  technicalCallees,
  translationModules,
  userFacingAttributes,
  userFacingVariableNames,
} from './i18n-taxonomy.js'
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
    'asyncGenerators',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'dynamicImport',
    'explicitResourceManagement',
    'importAttributes',
    'importMeta',
    'nullishCoalescingOperator',
    'objectRestSpread',
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
    const rawName = jsxAttribute.node.name.name
    const attributeName = normalizeAttributeName(rawName)
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

  const ancestorCalls = collectAncestorCalls(path)
  const nearestCall = ancestorCalls[0]
  if (ancestorCalls.some((call) => isTranslationCall(call, hasKnownTranslationBinding)))
    return undefined

  const notification = findNearestNotification(ancestorCalls)
  const variable = userFacingVariableFromPath(path)
  // Walk all ancestors: `console.log(foo('hello'))` is technical via the outer
  // call even though the nearest callee is `foo`. Technical wins over
  // notification (fail-closed: never extract logging/storage strings).
  if (ancestorCalls.some((call) => isTechnicalCallee(call.node.callee))) return undefined
  const jsxExpression = path.findParent((parent) => parent.isJSXExpressionContainer()) !== null

  const context = notification
    ? `notification:${notification}`
    : variable
      ? `variable:${variable}`
      : jsxExpression
        ? 'jsx-expression'
        : nearestCall
          ? `call:${calleeName(nearestCall.node.callee).toLowerCase()}`
          : 'script'
  const isUserFacing = Boolean(notification || variable || isReturnString(path) || jsxExpression)
  if (!isUserFacing || !isVisibleText(node.value) || isTechnicalValue(node.value)) return undefined

  return createCandidate({
    node,
    value: node.value,
    raw: options.content.slice(node.start, node.end),
    options,
    startOffset,
    context,
    category: categoryForContext(context, node.value),
    transform:
      jsxExpression && !notification && !variable ? 'react-expression-string' : 'script-string',
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
  // Pure `${x}` interpolations with no literal text are not findings; otherwise
  // `renderTemplateLiteral` would emit `${x}` (containing a letter) and flag empty strings.
  const hasLiteralText = node.quasis.some((quasi) =>
    isVisibleText(quasi.value.cooked ?? quasi.value.raw ?? ''),
  )
  if (!hasLiteralText) return undefined
  const value = renderTemplateLiteral(node)
  if (!isVisibleText(value) || isTechnicalValue(value)) return undefined

  const ancestorCalls = collectAncestorCalls(path)
  if (ancestorCalls.some((call) => isTranslationCall(call, hasKnownTranslationBinding)))
    return undefined
  if (ancestorCalls.some((call) => isTechnicalCallee(call.node.callee))) return undefined
  const notification = findNearestNotification(ancestorCalls)
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
  // Babel decodes entities in `node.value` (`&amp;` → `&`) while the raw slice
  // keeps the encoded source. Trim/range must use the raw slice so
  // `content.slice(range.start, range.end) === raw`; only `value` is decoded.
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

  const registerWrapper = (init: t.CallExpression, name: string) => {
    const callee = t.isIdentifier(init.callee)
      ? init.callee.name
      : t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.property)
        ? init.callee.property.name
        : ''
    if (callee === 'memo' || callee === 'forwardRef' || callee === 'observer') {
      const first = init.arguments[0]
      if (t.isArrowFunctionExpression(first) || t.isFunctionExpression(first)) {
        register(first, name)
      }
    }
  }

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id) register(path.node, path.node.id.name)
    },
    VariableDeclarator(path) {
      const { id, init } = path.node
      if (!t.isIdentifier(id) || !init) return
      if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
        register(init, id.name)
        return
      }
      // `memo(() => <div/>)`, `forwardRef((props) => <div/>)`, `memo(function Card(){})`.
      if (t.isCallExpression(init)) registerWrapper(init, id.name)
    },
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration
      if (t.isFunctionDeclaration(declaration) && declaration.id) {
        register(declaration, declaration.id.name)
      } else if (t.isVariableDeclaration(declaration)) {
        for (const declarator of declaration.declarations) {
          if (!t.isIdentifier(declarator.id) || !declarator.init) continue
          if (
            t.isArrowFunctionExpression(declarator.init) ||
            t.isFunctionExpression(declarator.init)
          ) {
            register(declarator.init, declarator.id.name)
          } else if (t.isCallExpression(declarator.init)) {
            registerWrapper(declarator.init, declarator.id.name)
          }
        }
      }
    },
    ExportDefaultDeclaration(path) {
      const declaration = path.node.declaration
      if (t.isFunctionDeclaration(declaration)) {
        register(declaration, declaration.id?.name ?? 'Default')
      } else if (t.isArrowFunctionExpression(declaration) || t.isFunctionExpression(declaration)) {
        register(declaration, 'Default')
      }
    },
  })
}

function findClosingParenEnd(content: string, start: number): number | undefined {
  if (content[start] !== '(') return undefined
  let depth = 0
  let quote: '"' | "'" | '`' | undefined
  let templateDepth = 0
  let regex = false
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
    if (regex) {
      if (character === '\\') index += 1
      else if (character === '/') regex = false
      continue
    }
    if (quote) {
      if (character === '\\') {
        index += 1
        continue
      }
      // Inside a template literal, `${` enters an expression where parens count again.
      if (quote === '`' && character === '$' && next === '{') {
        templateDepth += 1
        quote = undefined
        index += 1
        continue
      }
      if (character === quote) quote = undefined
      continue
    }
    if (templateDepth > 0 && character === '}') {
      templateDepth -= 1
      quote = '`'
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
    if (character === '/' && next !== '/' && next !== '*') {
      // Heuristic regex start: preceded by `(`, `=`, `:`, `,`, `!`, `&`, `|`, `?`, `{`, `;` or start.
      const prev = content.slice(0, index).trimEnd().slice(-1)
      if (prev === '' || ' (=:,!&|?{;['.includes(prev)) {
        regex = true
        continue
      }
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
    callee === 'intl.formatMessage' ||
    callee === 'i18nT'
  )
    return true
  // Bare `t/tc/te/translate` without an i18n import is likely a utility
  // function, not a translation call. Only exclude when binding is proven.
  if (!hasKnownTranslationBinding) return false
  if (callee === 't' || callee === 'tc' || callee === 'te' || callee === 'translate') return true
  if (callee.endsWith('.t') || callee.endsWith('.translate')) return true
  return /(^|\.)t$/u.test(callee)
}

function getNotificationType(
  callee: t.Expression | t.V8IntrinsicIdentifier,
): NotificationType | null {
  const name = calleeName(callee)
  // Bare `toast('msg')` / `notify('msg')` / `alert('msg')` are user-facing.
  if (notificationCallees.has(name)) return 'info'
  const parts = name.split('.')
  if (parts.length >= 2) {
    const head = parts[0]!
    const tail = parts.at(-1)!.toLowerCase()
    // `window.alert('x')` / `foo.message('x')`: trailing notification verb still
    // marks the call as user-facing even when the receiver is not a notifier.
    if (notificationCallees.has(head)) {
      if (tail === 'success') return 'success'
      if (tail === 'error') return 'error'
      if (tail === 'info') return 'info'
      if (tail === 'warn' || tail === 'warning') return 'warning'
      // `toast.info('x')`-style unknown methods are still notifications.
      return 'info'
    }
    if (tail === 'alert' || tail === 'notify' || tail === 'notification' || tail === 'toast') {
      return 'info'
    }
    // `message.success('x')` (e.g. Ant Design) where `message` is the receiver.
    if (head.toLowerCase() === 'message' || tail === 'message') return 'info'
  }
  return null
}

function collectAncestorCalls(path: NodePath): Array<NodePath<t.CallExpression>> {
  const calls: Array<NodePath<t.CallExpression>> = []
  let current: NodePath | null = path.parentPath
  while (current) {
    if (current.isCallExpression()) calls.push(current)
    current = current.parentPath
  }
  return calls
}

function findNearestNotification(
  calls: Array<NodePath<t.CallExpression>>,
): NotificationType | null {
  for (const call of calls) {
    const type = getNotificationType(call.node.callee)
    if (type) return type
  }
  return null
}

function isTechnicalCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  const name = calleeName(callee)
  if (technicalCallees.has(name)) return true
  const first = name.split('.')[0]!
  if (technicalCallees.has(first)) return true
  // `window.location.href(...)` should match the `window.location` entry.
  for (const entry of technicalCallees) {
    if (name === entry || name.startsWith(`${entry}.`)) return true
  }
  return false
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
  // `useState('...')`, `useState<string>('...')`, param defaults `f(x = 'hi')`.
  if (parent?.isCallExpression()) {
    const callee = calleeName(parent.node.callee)
    if (callee === 'useState' || callee.endsWith('.useState')) return 'text'
  }
  if (parent?.isAssignmentPattern()) {
    const left = parent.node.left
    if (t.isIdentifier(left) && userFacingVariableNames.has(left.name)) return left.name
    return undefined
  }
  // Destructuring default: `const { title = 'Hi' } = props` — only when the
  // key itself is user-facing.
  if (parent?.isObjectProperty() && t.isAssignmentPattern(parent.node.value)) {
    if (t.isIdentifier(parent.node.key) && userFacingVariableNames.has(parent.node.key.name)) {
      return parent.node.key.name
    }
    return undefined
  }
  return undefined
}

function isReturnString(path: NodePath<t.Node>): boolean {
  const parent = path.parentPath
  // Only a directly returned string counts. `return { foo: 'hi' }` is not
  // evidence the value is user-facing; the object key determines that.
  if (parent?.isReturnStatement()) return parent.node.argument === path.node
  return false
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

import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from './babel-compat.js'
import { parserPlugins } from './javascript-extractor.js'
import type { TextEdit } from './text-edit.js'
import type { ComponentContext, ScanResult } from './types.js'

export interface ReactBindingPlan {
  bindings: Map<string, string>
  edits: TextEdit[]
}

export function planReactBindings(
  content: string,
  filePath: string,
  findings: ScanResult[],
): ReactBindingPlan {
  const components = uniqueComponents(findings)
  if (components.length === 0) return { bindings: new Map(), edits: [] }

  const ast = parse(content, {
    sourceType: 'module',
    plugins: parserPlugins({
      typescript: filePath.endsWith('.ts') || filePath.endsWith('.tsx'),
      jsx: ['.js', '.jsx', '.tsx'].some((extension) => filePath.endsWith(extension)),
    }),
  })
  const bindings = new Map<string, string>()
  const hookRanges = new Set<string>()
  const allBindings = collectBindingNames(ast)
  let hasUseTranslationImport = false
  let hookCallee = 'useTranslation'

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'react-i18next') return
      for (const specifier of path.node.specifiers) {
        if (
          path.node.importKind !== 'type' &&
          (!('importKind' in specifier) || specifier.importKind !== 'type') &&
          t.isImportSpecifier(specifier) &&
          t.isIdentifier(specifier.imported) &&
          specifier.imported.name === 'useTranslation'
        ) {
          hasUseTranslationImport = true
          hookCallee = specifier.local.name
        }
      }
    },
    VariableDeclarator(path) {
      const id = path.node.id
      if ((!t.isIdentifier(id) && !t.isObjectPattern(id)) || !t.isCallExpression(path.node.init))
        return
      if (!t.isIdentifier(path.node.init.callee, { name: hookCallee })) return
      const declaration = path.parentPath
      if (!declaration?.isVariableDeclaration() || typeof declaration.node.start !== 'number')
        return
      const declarationStart = declaration.node.start
      const declarationEnd = declaration.node.end ?? declarationStart
      const containingComponents = components
        .filter(
          (component) => declarationStart >= component.start && declarationEnd <= component.end,
        )
        .sort((left, right) => right.start - left.start || left.end - right.end)
      const component = containingComponents[0]
      if (component && t.isObjectPattern(id)) {
        const property = id.properties.find(
          (item): item is t.ObjectProperty =>
            t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 't' }),
        )
        if (property && t.isIdentifier(property.value))
          bindings.set(component.id, property.value.name)
      }
    },
  })

  let needsImport = false
  for (const component of components) {
    if (bindings.has(component.id)) continue
    const name = allBindings.has('t') ? uniqueBindingName(component.id, allBindings) : 't'
    bindings.set(component.id, name)
    hookRanges.add(component.id)
    needsImport = true
  }

  const edits: TextEdit[] = []
  if (needsImport && !hasUseTranslationImport) {
    edits.push({
      range: {
        start: programInsertionOffset(ast.program, content),
        end: programInsertionOffset(ast.program, content),
      },
      replacement: buildReactImport(content, ast.program),
      kind: 'import',
      groupId: 'imports',
    })
  }

  for (const component of components) {
    if (!hookRanges.has(component.id)) continue
    const binding = bindings.get(component.id)!
    const hook =
      binding === 't'
        ? `const { t } = ${hookCallee}();`
        : `const { t: ${binding} } = ${hookCallee}();`
    if (component.expressionBody) {
      const indent = componentIndent(content, component)
      edits.push({
        range: { start: component.expressionStart!, end: component.expressionStart! },
        replacement: `\n${indent}{\n${indent}  ${hook}\n${indent}  return (`,
        kind: 'hook',
        groupId: component.id,
      })
      edits.push({
        range: { start: component.expressionEnd!, end: component.expressionEnd! },
        replacement: `)\n${indent}}`,
        kind: 'hook',
        groupId: component.id,
      })
    } else {
      edits.push({
        range: { start: component.bodyStart, end: component.bodyStart },
        replacement: withIndent(content, component, `\n${hook}`),
        kind: 'hook',
        groupId: component.id,
      })
    }
  }

  return { bindings, edits }
}

function uniqueComponents(findings: ScanResult[]): ComponentContext[] {
  const components = new Map<string, ComponentContext>()
  for (const finding of findings) {
    if (finding.component?.kind === 'react-function')
      components.set(finding.component.id, finding.component)
  }
  return [...components.values()].sort((left, right) => left.start - right.start)
}

function collectBindingNames(ast: t.File): Set<string> {
  const names = new Set<string>()
  traverse(ast, {
    VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id)) names.add(path.node.id.name)
    },
    Function(path) {
      for (const parameter of path.node.params) collectPatternNames(parameter, names)
    },
    CatchClause(path) {
      if (path.node.param) collectPatternNames(path.node.param, names)
    },
  })
  return names
}

function collectPatternNames(pattern: t.Node, names: Set<string>): void {
  if (t.isIdentifier(pattern)) names.add(pattern.name)
  else if (t.isRestElement(pattern)) collectPatternNames(pattern.argument, names)
  else if (t.isAssignmentPattern(pattern)) collectPatternNames(pattern.left, names)
  else if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) if (element) collectPatternNames(element, names)
  } else if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) collectPatternNames(property.argument, names)
      else if (t.isObjectProperty(property)) collectPatternNames(property.value as t.Node, names)
    }
  }
}

function programInsertionOffset(program: t.Program, content: string): number {
  const directiveEnds = program.directives.map((directive) => directive.end ?? 0)
  const importEnds = program.body
    .filter((statement): statement is t.ImportDeclaration => t.isImportDeclaration(statement))
    .map((statement) => statement.end ?? 0)
  const offset = Math.max(0, ...directiveEnds, ...importEnds)
  return offset === 0 ? 0 : Math.min(content.length, offset)
}

function buildReactImport(content: string, program: t.Program): string {
  const offset = programInsertionOffset(program, content)
  if (offset === 0) return "import { useTranslation } from 'react-i18next'\n"
  const prefix = content[offset - 1] === '\n' ? '' : '\n'
  return `${prefix}import { useTranslation } from 'react-i18next'`
}

function componentIndent(content: string, component: ComponentContext): string {
  const lineStart = content.lastIndexOf('\n', component.start - 1) + 1
  const prefix = content.slice(lineStart, component.start)
  return /^\s*/u.exec(prefix)?.[0] ?? ''
}

function withIndent(content: string, component: ComponentContext, replacement: string): string {
  const baseIndent = componentIndent(content, component)
  const bodyLine = content.slice(component.bodyStart).match(/^\r?\n([ \t]+)/u)?.[1]
  const indent = bodyLine ?? `${baseIndent}  `
  return replacement.replace(/\n/gu, `\n${indent}`)
}

function uniqueBindingName(componentId: string, used: Set<string>): string {
  const base = 'i18nT'
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}${index}`)) index += 1
  return `${base}${index}`
}

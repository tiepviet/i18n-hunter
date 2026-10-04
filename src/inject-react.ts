import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from './babel-compat.js'
import { HunterError } from './errors.js'
import { parserPlugins } from './javascript-extractor.js'
import { isJsxSourcePath, isTypeScriptSourcePath } from './path-policy.js'
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

  let ast: t.File
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: parserPlugins({
        typescript: isTypeScriptSourcePath(filePath),
        jsx: isJsxSourcePath(filePath),
      }),
    })
  } catch (error) {
    throw new HunterError(
      'E_PARSE_FAILED',
      `React binding planning failed to parse: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
      filePath,
    )
  }
  const bindings = new Map<string, string>()
  const hookRanges = new Set<string>()
  const allBindings = collectBindingNames(ast)
  let hasUseTranslationImport = false
  let hookCallee = 'useTranslation'

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value
      if (source !== 'react-i18next' && !source.startsWith('react-i18next/')) return
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
  })

  const isHookCallee = (callee: t.Node): boolean => {
    if (t.isIdentifier(callee, { name: hookCallee })) return true
    // `React.useTranslation()`, `i18n.useTranslation()` namespaced forms.
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      !callee.computed &&
      t.isIdentifier((callee as t.MemberExpression).property, { name: hookCallee })
    ) {
      return true
    }
    return false
  }

  traverse(ast, {
    VariableDeclarator(path) {
      const id = path.node.id
      const init = path.node.init
      if (!init) return
      // `const { t } = useTranslation()` / `const { t: x } = useTranslation()`.
      if (t.isCallExpression(init) && isHookCallee(init.callee) && t.isObjectPattern(id)) {
        const declaration = path.parentPath
        if (!declaration?.isVariableDeclaration() || typeof declaration.node.start !== 'number')
          return
        const declarationStart = declaration.node.start
        const declarationEnd = declaration.node.end ?? declarationStart
        const component = components
          .filter((item) => declarationStart >= item.start && declarationEnd <= item.end)
          .sort((left, right) => right.start - left.start || left.end - right.end)[0]
        if (component) {
          const property = id.properties.find(
            (item): item is t.ObjectProperty =>
              t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 't' }),
          )
          if (property && t.isIdentifier(property.value))
            bindings.set(component.id, property.value.name)
        }
        return
      }
      // `const t = useTranslation().t` — member form.
      if (
        t.isIdentifier(id) &&
        t.isMemberExpression(init) &&
        !init.computed &&
        t.isIdentifier(init.property, { name: 't' }) &&
        t.isCallExpression(init.object) &&
        isHookCallee((init.object as t.CallExpression).callee)
      ) {
        const declaration = path.parentPath
        if (!declaration?.isVariableDeclaration() || typeof declaration.node.start !== 'number')
          return
        const declarationStart = declaration.node.start
        const declarationEnd = declaration.node.end ?? declarationStart
        const component = components
          .filter((item) => declarationStart >= item.start && declarationEnd <= item.end)
          .sort((left, right) => right.start - left.start || left.end - right.end)[0]
        if (component) bindings.set(component.id, id.name)
      }
    },
  })

  let needsImport = false
  for (const component of components) {
    if (bindings.has(component.id)) continue
    const name = allBindings.has('t') ? uniqueBindingName(allBindings) : 't'
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
      const alreadyParenthesized =
        component.expressionStart !== undefined && content[component.expressionStart] === '('
      // `() => (<div/>)` is already parenthesized — do not add a second pair.
      const open = alreadyParenthesized ? 'return ' : 'return ('
      const close = alreadyParenthesized ? '' : ')'
      edits.push({
        range: { start: component.expressionStart!, end: component.expressionStart! },
        replacement: `\n${indent}{\n${indent}  ${hook}\n${indent}  ${open}`,
        kind: 'hook',
        groupId: component.id,
      })
      edits.push({
        range: { start: component.expressionEnd!, end: component.expressionEnd! },
        replacement: `${close}\n${indent}}`,
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
    ImportDeclaration(path) {
      for (const specifier of path.node.specifiers) {
        if (t.isImportSpecifier(specifier)) names.add(specifier.local.name)
        else if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
          names.add(specifier.local.name)
        }
      }
    },
    VariableDeclarator(path) {
      collectPatternNames(path.node.id as t.Node, names)
    },
    Function(path) {
      const node = path.node
      if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
        if (node.id) names.add(node.id.name)
      }
      for (const parameter of path.node.params) collectPatternNames(parameter, names)
    },
    ClassDeclaration(path) {
      if (path.node.id) names.add(path.node.id.name)
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
  if (offset === 0) {
    // Preserve shebang (`#!/usr/bin/env node`) and leading license comments.
    const match = /^(?:#!.*\n)?(?:\s*(?:\/\/.*|\/\*[\s\S]*?\*\/)\s*\n)*/u.exec(content)
    return match ? match[0].length : 0
  }
  return Math.min(content.length, offset)
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

function uniqueBindingName(used: Set<string>): string {
  const base = 'i18nT'
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}${index}`)) index += 1
  return `${base}${index}`
}

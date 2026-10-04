import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from './babel-compat.js'
import { HunterError } from './errors.js'
import { parserPlugins } from './javascript-extractor.js'
import { isTypeScriptSourcePath } from './path-policy.js'
import type { TextEdit } from './text-edit.js'
import type { ScanResult } from './types.js'

export interface VueBindingPlan {
  bindings: Map<string, string>
  edits: TextEdit[]
}

export function planVueBindings(
  content: string,
  filePath: string,
  findings: ScanResult[],
): VueBindingPlan {
  const setupComponents = new Map<string, ScanResult['component']>()
  for (const finding of findings) {
    if (finding.component?.kind === 'vue-script-setup' && finding.component) {
      setupComponents.set(finding.component.id, finding.component)
    }
    // NOTE: Vue Options API script findings are NOT rejected here. Template
    // findings need no script binding and are transformable on their own;
    // options-script findings fail per-finding in `bindingForFinding`
    // (`transform.ts`) with E_UNSUPPORTED_TRANSFORM listing file:line.
  }
  if (setupComponents.size === 0) return { bindings: new Map(), edits: [] }

  const allNames = new Set<string>()
  let hasUseI18nImport = false
  let hookCallee = 'useI18n'
  const reusable = new Set<string>()

  // Parse each `<script setup>` slice independently so multi-block files do not
  // reuse a stale AST or insertion offset.
  const slices = new Map<string, string>()
  const isHookCallee = (callee: t.Node): boolean => {
    if (t.isIdentifier(callee, { name: hookCallee })) return true
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      !callee.computed &&
      t.isIdentifier((callee as t.MemberExpression).property, { name: hookCallee })
    ) {
      return true
    }
    return false
  }
  for (const component of setupComponents.values()) {
    if (!component) continue
    const slice = content.slice(component.start, component.end)
    slices.set(component.id, slice)
    let ast: t.File
    try {
      ast = parse(slice, {
        sourceType: 'module',
        plugins: parserPlugins({ typescript: isTypeScriptSourcePath(filePath), jsx: false }),
      })
    } catch (error) {
      throw new HunterError(
        'E_PARSE_FAILED',
        `Vue script setup is not parseable: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
        filePath,
      )
    }
    traverse(ast, {
      ImportDeclaration(path) {
        // Collect ALL import bindings first: a non-i18n `import {t}` must still
        // count as a local `t` binding, otherwise we would emit a shadowing
        // `const {t}=useI18n()`. Only then check for the vue-i18n hook import.
        for (const specifier of path.node.specifiers) {
          if (
            t.isImportSpecifier(specifier) ||
            t.isImportDefaultSpecifier(specifier) ||
            t.isImportNamespaceSpecifier(specifier)
          ) {
            allNames.add(specifier.local.name)
          }
        }
        // Support `vue-i18n` subpaths (e.g. `vue-i18n/dist/...`) without false positives.
        const source: string = path.node.source.value
        if (source !== 'vue-i18n' && !source.startsWith('vue-i18n/')) return
        for (const specifier of path.node.specifiers) {
          if (
            path.node.importKind !== 'type' &&
            (!('importKind' in specifier) || specifier.importKind !== 'type') &&
            t.isImportSpecifier(specifier) &&
            t.isIdentifier(specifier.imported) &&
            specifier.imported.name === 'useI18n'
          ) {
            hasUseI18nImport = true
            hookCallee = specifier.local.name
          }
        }
      },
      VariableDeclarator(path) {
        collectVuePatternNames(path.node.id, allNames)
        // `const t = useI18n().t` member form reuses the existing binding.
        if (
          t.isIdentifier(path.node.id) &&
          t.isMemberExpression(path.node.init) &&
          !path.node.init.computed &&
          t.isIdentifier(path.node.init.property, { name: 't' }) &&
          t.isCallExpression(path.node.init.object) &&
          isHookCallee((path.node.init.object as t.CallExpression).callee)
        ) {
          reusable.add(path.node.id.name)
          return
        }
        if (!t.isObjectPattern(path.node.id) || !t.isCallExpression(path.node.init)) {
          return
        }
        if (!isHookCallee(path.node.init.callee)) return
        const property = path.node.id.properties.find(
          (item): item is t.ObjectProperty =>
            t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 't' }),
        )
        if (property && t.isIdentifier(property.value)) reusable.add(property.value.name)
      },
      Function(path) {
        const node = path.node
        if (t.isFunctionDeclaration(node) && node.id) allNames.add(node.id.name)
        for (const parameter of path.node.params) collectVuePatternNames(parameter, allNames)
      },
      ClassDeclaration(path) {
        if (path.node.id) allNames.add(path.node.id.name)
      },
      CatchClause(path) {
        if (path.node.param) collectVuePatternNames(path.node.param, allNames)
      },
    })
  }

  const hasLocalTBinding = allNames.has('t') && !reusable.has('t')
  const bindings = new Map<string, string>()
  const edits: TextEdit[] = []
  const usedNames = new Set([...allNames, ...reusable])
  for (const component of setupComponents.values()) {
    if (!component) continue
    const binding = reusable.has('t') ? 't' : hasLocalTBinding ? uniqueName(usedNames) : 't'
    bindings.set(component.id, binding)
    const insertion = firstCodeOffset(content, component.start)
    const needsTranslationHook = !reusable.has('t') && !reusable.has(binding)
    const importEdit =
      hasUseI18nImport || !needsTranslationHook ? '' : "import { useI18n } from 'vue-i18n'"
    const hookEdit = needsTranslationHook
      ? binding === 't'
        ? `const { t } = ${hookCallee}()`
        : `const { t: ${binding} } = ${hookCallee}()`
      : ''
    const replacement = [importEdit, hookEdit].filter(Boolean).join('\n')
    if (replacement) {
      edits.push({
        range: { start: insertion, end: insertion },
        replacement: `${replacement}\n`,
        kind: 'import',
        groupId: component.id,
      })
    }
    reusable.add(binding)
    usedNames.add(binding)
  }

  return { bindings, edits }
}

function firstCodeOffset(content: string, blockStart: number): number {
  const whitespace = content.slice(blockStart).match(/^\s*/u)?.[0].length ?? 0
  return blockStart + whitespace
}

function collectVuePatternNames(pattern: t.Node, names: Set<string>): void {
  if (t.isIdentifier(pattern)) names.add(pattern.name)
  else if (t.isRestElement(pattern)) collectVuePatternNames(pattern.argument, names)
  else if (t.isAssignmentPattern(pattern)) collectVuePatternNames(pattern.left, names)
  else if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) if (element) collectVuePatternNames(element, names)
  } else if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) collectVuePatternNames(property.argument, names)
      else if (t.isObjectProperty(property)) collectVuePatternNames(property.value as t.Node, names)
    }
  }
}

function uniqueName(used: Set<string>): string {
  if (!used.has('i18nT')) return 'i18nT'
  let index = 2
  while (used.has(`i18nT${index}`)) index += 1
  return `i18nT${index}`
}

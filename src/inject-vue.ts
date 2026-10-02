import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from './babel-compat.js'
import { HunterError } from './errors.js'
import { parserPlugins } from './javascript-extractor.js'
import { isVueSourcePath } from './path-policy.js'
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
    if (finding.component?.kind === 'vue-options') {
      throw new HunterError(
        'E_UNSUPPORTED_TRANSFORM',
        'Vue Options API script transforms are not supported by this transform plan',
      )
    }
  }
  if (setupComponents.size === 0) return { bindings: new Map(), edits: [] }

  const firstComponent = setupComponents.values().next().value
  if (!firstComponent) return { bindings: new Map(), edits: [] }
  const ast = parse(content.slice(firstComponent.start, firstComponent.end), {
    sourceType: 'module',
    plugins: parserPlugins({ typescript: isVueSourcePath(filePath), jsx: false }),
  })
  let hasUseI18nImport = false
  let hookCallee = 'useI18n'
  let hasLocalTBinding = false
  const reusable = new Set<string>()

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'vue-i18n') return
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
      if (t.isIdentifier(path.node.id, { name: 't' })) hasLocalTBinding = true
      if (!t.isObjectPattern(path.node.id) || !t.isCallExpression(path.node.init)) return
      if (!t.isIdentifier(path.node.init.callee, { name: hookCallee })) return
      const property = path.node.id.properties.find(
        (item): item is t.ObjectProperty =>
          t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 't' }),
      )
      if (property && t.isIdentifier(property.value)) reusable.add(property.value.name)
    },
  })

  const bindings = new Map<string, string>()
  const edits: TextEdit[] = []
  for (const component of setupComponents.values()) {
    if (!component) continue
    const binding = reusable.has('t') || !hasLocalTBinding ? 't' : uniqueName(reusable)
    bindings.set(component.id, binding)
    const insertion = firstCodeOffset(content, component.start)
    const needsTranslationHook = !reusable.has('t')
    const importEdit =
      hasUseI18nImport || !needsTranslationHook ? '' : "import { useI18n } from 'vue-i18n'"
    const hookEdit = needsTranslationHook
      ? binding === 't'
        ? `const { t } = ${hookCallee}()`
        : `const { t: ${binding} } = ${hookCallee}()`
      : ''
    const replacement = [importEdit, hookEdit].filter(Boolean).join('\n\n')
    if (replacement) {
      edits.push({
        range: { start: insertion, end: insertion },
        replacement: `${replacement}\n`,
        kind: 'import',
        groupId: component.id,
      })
    }
    reusable.add(binding)
  }

  return { bindings, edits }
}

function firstCodeOffset(content: string, blockStart: number): number {
  const whitespace = content.slice(blockStart).match(/^\s*/u)?.[0].length ?? 0
  return blockStart + whitespace
}

function uniqueName(used: Set<string>): string {
  if (!used.has('i18nT')) return 'i18nT'
  let index = 2
  while (used.has(`i18nT${index}`)) index += 1
  return `i18nT${index}`
}

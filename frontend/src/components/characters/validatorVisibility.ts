import { evaluate, isVisible } from './expressions'
import type { ExprContext } from './expressions'
import type { LayoutNode, SheetDocument } from './LayoutRenderer'
import type { ValidatorResult } from './ValidatorMessages'

// One entry in a JSON layout section: a field's name, or `{field: name}`.
type LayoutEntry = string | { field?: string } | null | undefined

interface LayoutSection {
  visible_if?: string
  fields?: LayoutEntry[]
  rows?: LayoutEntry[]
}

interface FieldWithCondition {
  visible_if?: string
}

/**
 * The fields the sheet is not showing right now, so their validators can wait.
 *
 * A validator attached to a field (`field` on the validator) is about that
 * field, and a warning about something the player cannot see on the sheet only
 * sits there with nothing to act on (issue #765). A field is hidden when its own
 * `visible_if` is false, or when the layout places it and every place it does
 * is inside something hidden: a section, a tab, a `<g-if>`, or the directive's
 * own `visible_if`.
 *
 * A field the layout never places is not counted as hidden. Leaving a field out
 * of the layout is not a statement that it does not apply, and it is still on
 * **All values**. Inside a `<g-repeat>` each row has its own context, so a
 * placement there counts as shown once the repeat itself is.
 *
 * `layoutDocument` is the one the sheet is drawing, so a phone layout that moves
 * a field out of a hidden tab is honoured.
 */
export function hiddenFields(
  schemaDocument: SheetDocument | null | undefined,
  layoutDocument: SheetDocument | null | undefined,
  context: ExprContext
): Set<string> {
  const fields = (schemaDocument?.fields || {}) as Record<string, FieldWithCondition | undefined>
  const hidden = new Set<string>()
  for (const [name, definition] of Object.entries(fields)) {
    if (definition?.visible_if && !isVisible(definition.visible_if, context)) hidden.add(name)
  }

  // name → whether any placement of it is currently drawn.
  const placements = new Map<string, boolean>()
  const place = (name: string | undefined, shown: boolean) => {
    if (!name) return
    placements.set(name, placements.get(name) || shown)
  }

  const ast = layoutDocument?.layout_ast
  if (Array.isArray(ast) && ast.length) {
    walk(ast as LayoutNode[], true, false, context, place)
  } else if (Array.isArray(schemaDocument?.layout)) {
    for (const section of schemaDocument.layout as LayoutSection[]) {
      const shown = isVisible(section?.visible_if, context)
      for (const entry of section?.fields || section?.rows || []) {
        place(typeof entry === 'string' ? entry : entry?.field, shown)
      }
    }
  }

  for (const [name, shown] of placements) if (!shown) hidden.add(name)
  return hidden
}

/** The validators worth showing: the sheet-wide ones, and those on a shown field. */
export function visibleValidators(
  results: ValidatorResult[],
  hidden: Set<string>
): ValidatorResult[] {
  if (!hidden.size) return results
  return results.filter((result) => !result.field || !hidden.has(result.field))
}

function walk(
  nodes: LayoutNode[],
  shown: boolean,
  inRepeat: boolean,
  context: ExprContext,
  place: (name: string | undefined, shown: boolean) => void
): void {
  for (const node of nodes) {
    if (!node?.tag) continue
    const attrs = node.attrs || {}
    // Conditions are checked the way LayoutRenderer checks them: `visible_if`
    // shows on a broken expression, `<g-if>` hides on one. Inside a repeat they
    // may read the row, which this has no context for, so they are not judged.
    let here = shown
    if (!inRepeat) {
      if (attrs.visible_if && !isVisible(attrs.visible_if, context)) here = false
      if (node.tag === 'g-if' && !evaluate(attrs.test, context)) here = false
    }

    switch (node.tag) {
      case 'g-field':
      case 'g-computed':
      case 'g-label':
      case 'g-value':
        place(attrs.name, here)
        break
      case 'g-option':
        place(attrs.field, here)
        break
      case 'g-pips':
        place(attrs.value, here)
        break
      case 'g-tier':
        for (const name of String(attrs.fields || '').split(/\s+/)) place(name, here)
        break
      case 'g-repeat':
        place(attrs.over, here)
        break
    }

    if (node.children?.length) {
      walk(node.children, here, inRepeat || node.tag === 'g-repeat', context, place)
    }
  }
}

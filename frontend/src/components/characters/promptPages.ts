import { evaluate } from './expressions'
import type { ExprContext } from './expressions'
import { catalogKey, entryKey, filterCatalog } from './promptCatalog'
import type { CatalogRead } from './promptCatalog'
import { entriesTarget, isAnswered, isEntry, promptContext } from './sheetPrompts'
import type {
  Answers,
  EntryAnswer,
  PromptDocument,
  PromptPageDefinition,
  PromptStep,
  SheetPrompt,
} from './sheetPrompts'

/**
 * A prompt as the dialog shows it: its pages, and for the answers given so
 * far which steps show, what each catalog step offers, and which are answered.
 *
 * A prompt that is not `paged` is one page holding every step. A paged one
 * has a page per `page` name its steps give, in the order the steps first
 * name it, and a step without one is alone on its own page. A page none of
 * whose steps shows is passed over.
 */

type Values = Record<string, unknown>

const FAILED = Symbol('failed')

/** One page of a prompt: its name, how `pages` describes it, and its steps' keys. */
export interface PromptPage extends PromptPageDefinition {
  name: string
  keys: string[]
}

/** One step showing, as the dialog draws it. */
export interface StepState {
  step: PromptStep
  // The sheet and the answers of the steps showing before it.
  context: ExprContext
  // Its answer, once the `filter` has let go of a choice it no longer passes.
  answer: unknown
  // A catalog step's entries once the catalog is read, or why it could not be.
  options?: EntryAnswer[]
  failed?: string
  // On a page the player skipped: it waits for later and blocks nothing.
  skipped: boolean
  answered: boolean
}

export interface PromptState {
  steps: StepState[]
  // The answers of the steps showing, skipped pages left out: what `apply` reads.
  answers: Answers
  // Answers the `filter` let go of, each with what is left of it (undefined
  // for nothing), to be taken into the dialog's own answers.
  dropped: Answers
}

function isObject(value: unknown): value is Values {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

/** A prompt's pages, in order. */
export function promptPages(prompt: SheetPrompt): PromptPage[] {
  const steps = (Array.isArray(prompt.steps) ? prompt.steps : []).filter(
    (step): step is PromptStep => isObject(step) && typeof step.key === 'string'
  )
  if (!prompt.paged) return [{ name: '', keys: steps.map((step) => step.key) }]
  const pages: PromptPage[] = []
  const byName = new Map<string, PromptPage>()
  for (const step of steps) {
    const named = typeof step.page === 'string' && step.page ? step.page : ''
    // An unnamed step's page cannot share a name with a named one: a page
    // name is an identifier, and this is not.
    const name = named || `#${step.key}`
    let page = byName.get(name)
    if (!page) {
      const definition = named ? own(prompt.pages, named) : undefined
      page = { name, keys: [] }
      if (isObject(definition)) {
        if (typeof definition.label === 'string' && definition.label) {
          page.label = definition.label
        }
        if (typeof definition.later === 'string' && definition.later) {
          page.later = definition.later
        }
      }
      pages.push(page)
      byName.set(name, page)
    }
    page.keys.push(step.key)
  }
  return pages
}

function visibleFor(step: PromptStep, context: ExprContext): boolean {
  if (!step.visible_if) return true
  const value = evaluate<symbol>(step.visible_if, context, FAILED)
  return value !== FAILED && Boolean(value)
}

// What a catalog step offers for its answer, and what is left of the answer
// once the `filter` has had its say. The filter reads the answers before the
// step and the step's own, so an `entries` choice whose prerequisite is
// another choice of the same step goes when that one is unticked - and one
// resting on it after that, until nothing more goes.
function narrow(
  step: PromptStep,
  catalog: EntryAnswer[],
  before: Answers,
  answer: unknown,
  row: Values | null | undefined,
  base: Values
): { options: EntryAnswer[]; answer: unknown } {
  const read = (own: unknown) =>
    filterCatalog(step, catalog, promptContext(base, { ...before, [step.key]: own }, row))
  if (step.type === 'entries') {
    let kept = Array.isArray(answer) ? answer.filter(isEntry) : []
    // Each pass lets at least one go, so this many passes always settle.
    const passes = kept.length
    for (let pass = 0; pass <= passes; pass += 1) {
      const options = read(kept)
      const offered = new Set(options.map(entryKey))
      const next = kept.filter((entry) => offered.has(entryKey(entry)))
      if (next.length === kept.length) {
        return { options, answer: kept.length ? kept : undefined }
      }
      kept = next
    }
    return { options: read(kept), answer: kept.length ? kept : undefined }
  }
  if (!isEntry(answer)) return { options: read(answer), answer }
  const options = read(answer)
  if (options.some((entry) => entryKey(entry) === entryKey(answer))) return { options, answer }
  return { options: read(undefined), answer: undefined }
}

function sameEntries(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return isEntry(a) && isEntry(b) && entryKey(a) === entryKey(b)
  }
  return a.length === b.length && a.every((entry, i) => entryKey(entry) === entryKey(b[i]))
}

/**
 * Work out what the dialog shows for these answers.
 *
 * @param catalogs  each catalog step's read, by `catalogKey`; a read not
 *   there yet is still loading, and its step's answer is left as it is
 * @param skipped   the names of the pages the player skipped
 */
export function promptState(
  prompt: SheetPrompt,
  {
    context,
    answers,
    row,
    document,
    data,
    catalogs = {},
    skipped = new Set<string>(),
  }: {
    context: Values
    answers: Answers
    row?: Values | null
    document: PromptDocument | null | undefined
    data: Values | null | undefined
    catalogs?: Record<string, CatalogRead>
    skipped?: Set<string>
  }
): PromptState {
  const pageOf = new Map<string, string>()
  for (const page of promptPages(prompt)) {
    for (const key of page.keys) pageOf.set(key, page.name)
  }
  const kept: Answers = {}
  const dropped: Answers = {}
  const steps: StepState[] = []
  for (const step of Array.isArray(prompt.steps) ? prompt.steps : []) {
    if (!isObject(step) || typeof step.key !== 'string') continue
    const before = { ...kept }
    const stepContext = promptContext(context, before, row)
    if (!visibleFor(step, stepContext)) continue
    const isSkipped = skipped.has(pageOf.get(step.key) ?? '')
    let answer = isSkipped ? undefined : answers[step.key]
    const state: StepState = {
      step,
      context: stepContext,
      answer,
      skipped: isSkipped,
      answered: true,
    }
    const key = catalogKey(step)
    const read = key ? catalogs[key] : undefined
    if (Array.isArray(read)) {
      const narrowed = narrow(step, read, before, answer, row, context)
      state.options = narrowed.options
      if (!isSkipped && !sameEntries(narrowed.answer, answer)) {
        dropped[step.key] = narrowed.answer
        answer = narrowed.answer
      }
    } else if (read) {
      state.options = []
      state.failed = read.error
    }
    // A catalog that could not be read offers nothing, which is not the same
    // as offering fewer than asked: the step waits for its whole count.
    const available = state.failed ? undefined : state.options?.length
    // An `entries` step that now asks for nothing - its count worked out to
    // 0 once an earlier answer changed - keeps none of what was ticked.
    if (
      !isSkipped &&
      step.type === 'entries' &&
      answer !== undefined &&
      entriesTarget(step, stepContext, available) === 0
    ) {
      dropped[step.key] = undefined
      answer = undefined
    }
    state.answer = answer
    if (!isSkipped) {
      state.answered = isAnswered(step, answer, stepContext, document, data, available)
      if (answer !== undefined) kept[step.key] = answer
    }
    steps.push(state)
  }
  return { steps, answers: kept, dropped }
}

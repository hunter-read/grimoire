import { createContext } from 'react'
import { buildContext, computeValues, evaluate, toNumber } from './expressions'
import type { ExprContext, ExpressionDocument } from './expressions'
import { GRANTED_KEY, asList as listOf, grantInto } from './onPick'
import type { ResolvedRefs } from './onPick'
import { planAction } from './sheetActions'
import type { ActionStep } from './sheetActions'
import type { FieldDefinition } from './FieldRenderer'

/**
 * A sheet's `prompts`: windows that ask the player a few questions and write
 * the answers - a level gained is hit points, then an ability increase or a
 * feat, the feat picked from the catalog. Each is data, checked by the server
 * when the sheet is installed (`_validate_prompts`): a list of `steps`, one
 * question each, and an `apply` list of writes made once the player confirms.
 *
 * A prompt opens from an `on_pick` rule (`{prompt}`, reading the picked entry
 * as `row`), from an action's `{prompt}` step, or from a `<g-action prompt>`
 * button. Skipping is always allowed: the prompt is then kept under
 * `_pending_prompts`, and the sheet offers to open it again.
 */

type Values = Record<string, unknown>

export const PENDING_PROMPTS_KEY = '_pending_prompts'

// The most catalog entries an `entry` step reads, in pages of the catalog's
// largest size. A feat list is a few hundred; a filter narrows the rest.
const ENTRY_PAGE_SIZE = 200
const ENTRY_MAX_PAGES = 10

export type PromptStepType = 'choose' | 'distribute' | 'entry' | 'number' | 'select'

export interface PromptStep {
  key: string
  type: PromptStepType
  label?: string
  // Text worked out from the sheet and the answers before it, shown in place
  // of `label` when it is not empty.
  label_formula?: string
  visible_if?: string
  // choose
  target?: string
  count?: number | string
  // choose, distribute, select
  options?: string | (string | number | { value: string | number; label?: string })[]
  // distribute
  patterns?: string[]
  // entry
  content_type?: string
  filters?: Record<string, string | number>
  filter?: string
  // number
  default?: string
  average?: string
  min?: number
  max?: number
}

export interface PromptApplyStep extends Omit<ActionStep, 'values'> {
  add?: string
  pick?: string
  // unpick: the content_list a row is taken out of, the row of `entry`.
  unpick?: string
  entry?: string
  // grant: formulas for the ids, the names they fall back to, and the values
  // carried onto a freeform entry; `source` is the pick it is recorded under.
  grant?: string
  from?: string
  names?: string
  carry?: Record<string, string>
  source?: string
  // An `append`'s or a `pick`'s per-entry formulas; an `add`'s one formula.
  values?: string | Record<string, string>
}

export interface SheetPrompt {
  label: string
  steps: PromptStep[]
  apply: PromptApplyStep[]
  // Writes made when the prompt is put aside, in place of keeping it for later.
  on_skip?: ActionStep[]
}

/** A prompt waiting to be shown: which one, and the pick that opened it. */
export type PromptRequest = {
  prompt: string
  // The field whose pick opened it, and the entry picked: what `row` reads,
  // and where what the prompt grants is recorded so a new pick takes it back.
  source?: string
  ref?: string
  row?: Values | null
}

/** An `entry` step's answer: the catalog entry, its id and its properties. */
export type EntryAnswer = Values & { _ref: string; _source?: string; name?: string }

export type Answers = Record<string, unknown>

export interface PromptOption {
  value: string
  label: string
}

export interface PromptDocument extends ExpressionDocument {
  fields?: Record<string, FieldDefinition>
  prompts?: unknown
  [key: string]: unknown
}

/** Opens one of the sheet's prompts; provided by the character view. */
export const PromptLauncher = createContext<((request: PromptRequest) => void) | null>(null)

const FAILED = Symbol('failed')

function isObject(value: unknown): value is Values {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function findPrompt(
  document: PromptDocument | null | undefined,
  name: string | undefined
): SheetPrompt | undefined {
  const prompts = document?.prompts
  if (!name || !isObject(prompts) || !Object.prototype.hasOwnProperty.call(prompts, name)) {
    return undefined
  }
  const prompt = prompts[name]
  return isObject(prompt) && Array.isArray(prompt.steps)
    ? (prompt as unknown as SheetPrompt)
    : undefined
}

/**
 * The sheet as its formulas read it - field values with their defaults,
 * computed values, the resolved entries - as the sheet itself builds it.
 */
export function sheetContext(
  document: PromptDocument | null | undefined,
  data: Values | null | undefined,
  entries: Record<string, unknown> = {}
): Values {
  const withEntries = Object.keys(entries).length
    ? { ...(data || {}), _entries: entries }
    : data || {}
  return { ...buildContext(document, withEntries), ...computeValues(document, withEntries) }
}

/** What a prompt's formulas read: the sheet, the answers, the picked entry. */
export function promptContext(context: Values, answers: Answers, row?: Values | null): ExprContext {
  return { ...context, answer: answers, row: row || {} }
}

function visible(step: PromptStep, context: ExprContext): boolean {
  if (!step.visible_if) return true
  const value = evaluate<symbol>(step.visible_if, context, FAILED)
  return value !== FAILED && Boolean(value)
}

/**
 * The steps showing for these answers, in order. A step's `visible_if` reads
 * only the answers of the visible steps before it, so a hidden branch's
 * leftovers never show a step they no longer call for.
 */
export function visibleSteps(
  prompt: SheetPrompt,
  context: Values,
  answers: Answers,
  row?: Values | null
): PromptStep[] {
  const shown: PromptStep[] = []
  const seen: Answers = {}
  for (const step of prompt.steps) {
    if (!step || typeof step !== 'object') continue
    if (visible(step, promptContext(context, seen, row))) {
      shown.push(step)
      if (step.key in answers) seen[step.key] = answers[step.key]
    }
  }
  return shown
}

/** The answers of the visible steps only: what `apply` reads. */
export function visibleAnswers(
  prompt: SheetPrompt,
  context: Values,
  answers: Answers,
  row?: Values | null
): Answers {
  const kept: Answers = {}
  for (const step of visibleSteps(prompt, context, answers, row)) {
    if (step.key in answers) kept[step.key] = answers[step.key]
  }
  return kept
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function toOption(option: unknown): PromptOption | null {
  if (isObject(option)) {
    if (option.value === undefined || option.value === null) return null
    const value = String(option.value)
    return { value, label: typeof option.label === 'string' && option.label ? option.label : value }
  }
  if (option === undefined || option === null || option === '') return null
  return { value: String(option), label: String(option) }
}

/**
 * A step's options: listed by hand, worked out by a formula, or - for a
 * `choose` without either - the target multiselect's own. A value the target
 * does not offer is left out, as a grant leaves it out.
 */
export function stepOptions(
  step: PromptStep,
  context: ExprContext,
  document: PromptDocument | null | undefined
): PromptOption[] {
  const target = step.target ? document?.fields?.[step.target] : undefined
  const targetOptions = (Array.isArray(target?.options) ? target.options : [])
    .map(toOption)
    .filter((option): option is PromptOption => !!option)
  let raw: unknown[]
  if (typeof step.options === 'string')
    raw = asList(evaluate<symbol>(step.options, context, FAILED))
  else if (Array.isArray(step.options)) raw = step.options
  else raw = targetOptions
  const labels = new Map(targetOptions.map((option) => [option.value, option.label]))
  const seen = new Set<string>()
  const options: PromptOption[] = []
  for (const item of raw) {
    const option = toOption(item)
    if (!option || seen.has(option.value)) continue
    if (target && labels.size && !labels.has(option.value)) continue
    seen.add(option.value)
    options.push(
      option.label === option.value && labels.has(option.value)
        ? { ...option, label: labels.get(option.value)! }
        : option
    )
  }
  return options
}

/** How many a `choose` asks for. */
export function stepCount(step: PromptStep, context: ExprContext): number {
  const count =
    typeof step.count === 'string' ? toNumber(evaluate(step.count, context)) : (step.count ?? 1)
  return Math.max(0, Math.floor(Number(count) || 0))
}

/** A `distribute` step's patterns as amounts, largest first: "1,2" → [2, 1]. */
export function stepPatterns(step: PromptStep): number[][] {
  return (step.patterns || [])
    .map((pattern) =>
      String(pattern)
        .split(',')
        .map((amount) => Number(amount))
        .filter((amount) => amount > 0)
        .sort((a, b) => b - a)
    )
    .filter((amounts) => amounts.length)
}

/** Whether points spread as `spread` follow one of the patterns allowed. */
export function matchesPattern(spread: unknown, patterns: number[][]): boolean {
  if (!isObject(spread)) return false
  const amounts = Object.values(spread)
    .map((amount) => Number(amount) || 0)
    .filter((amount) => amount > 0)
    .sort((a, b) => b - a)
  return patterns.some(
    (pattern) =>
      pattern.length === amounts.length && pattern.every((amount, i) => amount === amounts[i])
  )
}

/** The values a `choose` step's target already holds, which it leaves out. */
export function ownedValues(step: PromptStep, data: Values | null | undefined): Set<string> {
  const held = step.target ? data?.[step.target] : undefined
  return new Set(Array.isArray(held) ? held.map(String) : [])
}

/** How many a `choose` really asks for: no more than there are left to take. */
export function chooseTarget(
  step: PromptStep,
  context: ExprContext,
  document: PromptDocument | null | undefined,
  data: Values | null | undefined
): number {
  const owned = ownedValues(step, data)
  const free = stepOptions(step, context, document).filter((option) => !owned.has(option.value))
  return Math.min(stepCount(step, context), free.length)
}

/** Whether a step has an answer the prompt can be confirmed with. */
export function isAnswered(
  step: PromptStep,
  answer: unknown,
  context: ExprContext,
  document: PromptDocument | null | undefined,
  data: Values | null | undefined
): boolean {
  switch (step.type) {
    case 'choose': {
      const wanted = chooseTarget(step, context, document, data)
      return wanted === 0 || (Array.isArray(answer) && answer.length === wanted)
    }
    case 'distribute':
      return matchesPattern(answer, stepPatterns(step))
    case 'entry':
      return isObject(answer) && typeof answer._ref === 'string' && !!answer._ref
    case 'number':
      return typeof answer === 'number' && Number.isFinite(answer)
    case 'select':
      return (
        typeof answer === 'string' &&
        stepOptions(step, context, document).some((option) => option.value === answer)
      )
    default:
      return false
  }
}

/** Whether every step showing has its answer. */
export function isComplete(
  prompt: SheetPrompt,
  context: Values,
  answers: Answers,
  document: PromptDocument | null | undefined,
  data: Values | null | undefined,
  row?: Values | null
): boolean {
  const steps = visibleSteps(prompt, context, answers, row)
  const seen: Answers = {}
  for (const step of steps) {
    if (!isAnswered(step, answers[step.key], promptContext(context, seen, row), document, data)) {
      return false
    }
    seen[step.key] = answers[step.key]
  }
  return steps.length > 0
}

/** A `number` step's starting value, from its `default` formula. */
export function numberDefault(step: PromptStep, context: ExprContext): number | undefined {
  if (!step.default) return undefined
  const value = evaluate<symbol>(step.default, context, FAILED)
  if (value === FAILED || value === '' || value === null) return undefined
  const number = toNumber(value)
  return Number.isFinite(number) ? clampNumber(step, number) : undefined
}

/** A `number` step's average, for its «Use average» button. */
export function numberAverage(step: PromptStep, context: ExprContext): number | undefined {
  if (!step.average) return undefined
  const value = evaluate<symbol>(step.average, context, FAILED)
  if (value === FAILED) return undefined
  const number = toNumber(value)
  return Number.isFinite(number) ? clampNumber(step, number) : undefined
}

export function clampNumber(step: PromptStep, value: number): number {
  let result = value
  if (typeof step.min === 'number') result = Math.max(step.min, result)
  if (typeof step.max === 'number') result = Math.min(step.max, result)
  return result
}

/** A catalog entry as an `entry` step's answer, and as its `filter` reads it. */
export function entryAnswer(entry: {
  entry_id: string
  source?: string
  name?: string
  data?: unknown
}): EntryAnswer {
  return {
    ...(isObject(entry.data) ? entry.data : {}),
    name: entry.name,
    _ref: entry.entry_id,
    _source: entry.source,
  }
}

/** Whether an entry passes an `entry` step's `filter`. One that fails to work out is left out. */
export function passesFilter(step: PromptStep, entry: EntryAnswer, context: ExprContext): boolean {
  if (!step.filter) return true
  const value = evaluate<symbol>(step.filter, { ...context, entry }, FAILED)
  return value !== FAILED && Boolean(value)
}

/**
 * Every entry an `entry` step offers: the catalog read in pages, with the
 * step's fixed `filters` asked of the server and its `filter` formula worked
 * out here, where the character is known.
 */
export async function loadEntryOptions(
  step: PromptStep,
  context: ExprContext,
  browse: (
    page: number,
    pageSize: number
  ) => Promise<{
    entries?: { entry_id: string; source?: string; name?: string; data?: unknown }[]
    total?: number
  }>
): Promise<EntryAnswer[]> {
  const found: EntryAnswer[] = []
  for (let page = 1; page <= ENTRY_MAX_PAGES; page += 1) {
    const result = await browse(page, ENTRY_PAGE_SIZE)
    const rows = result.entries || []
    for (const row of rows) {
      const entry = entryAnswer(row)
      if (passesFilter(step, entry, context)) found.push(entry)
    }
    if (rows.length < ENTRY_PAGE_SIZE || page * ENTRY_PAGE_SIZE >= (result.total ?? 0)) break
  }
  return found
}

/** A pick a prompt makes, followed up as a pick by hand: its `on_pick` runs. */
// `entry` is the entry picked; a row taken out (`unpick`) has none.
export type PromptPick = { field: string; value: unknown; entry?: Values }

/**
 * A `grant` a prompt makes, its formulas worked out: what `planGrants` adds
 * once the catalog has said which ids it really has.
 */
export type PromptGrant = {
  target: string
  pairs: [string, string][]
  carried: Values
  source?: string
}

/**
 * What confirming a prompt does: the patch of plain writes, the picks to make
 * through the sheet's own pick path, and the prompts its `apply` opens next.
 *
 * Every formula reads the sheet as it stood when the prompt opened, plus the
 * answers. `set`, `each` and `append` are worked out as an action's steps;
 * `add` and `pick` after them, in order.
 */
export function planPrompt(
  prompt: SheetPrompt,
  {
    document,
    data,
    context,
    answers,
    row,
    source,
  }: {
    document: PromptDocument | null | undefined
    data: Values | null | undefined
    context: Values
    answers: Answers
    row?: Values | null
    source?: string
  }
): { patch: Values; picks: PromptPick[]; prompts: string[]; grants: PromptGrant[] } {
  const fields = document?.fields || {}
  const ctx = promptContext(context, visibleAnswers(prompt, context, answers, row), row)
  const steps = Array.isArray(prompt.apply) ? prompt.apply : []
  const writes = steps.filter(
    (step) =>
      step &&
      (typeof step.each === 'string' ||
        typeof step.append === 'string' ||
        typeof step.set === 'string') &&
      typeof step.add !== 'string' &&
      typeof step.pick !== 'string' &&
      typeof step.unpick !== 'string' &&
      typeof step.grant !== 'string' &&
      typeof step.prompt !== 'string'
  )
  const patch: Values = writes.length
    ? planAction(
        { name: '', label: '', steps: writes as ActionStep[] },
        { document, data: data || {}, context: ctx }
      )
    : {}
  const picks: PromptPick[] = []
  const prompts: string[] = []
  const grants: PromptGrant[] = []
  const granted: Record<string, string[]> = {}
  const current = (name: string): unknown => (name in patch ? patch[name] : data?.[name])

  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    if (typeof step.prompt === 'string') {
      prompts.push(step.prompt)
      continue
    }
    if (typeof step.grant === 'string') {
      // Worked out now, against the sheet as the prompt read it; made by
      // `planGrants`, which asks the catalog first.
      const ids = listOf(evaluate<symbol>(step.from, ctx, FAILED))
      const names = step.names ? listOf(evaluate<symbol>(step.names, ctx, FAILED)) : []
      const carried: Values = {}
      for (const [key, formula] of Object.entries(isObject(step.carry) ? step.carry : {})) {
        const value = evaluate<symbol>(formula, ctx, FAILED)
        if (value !== FAILED && value !== '' && value !== null && value !== undefined) {
          carried[key] = value
        }
      }
      const pairs = ids.map((id, i): [string, string] => [id, names[i] || ''])
      if (pairs.length) {
        const recordedUnder = step.source || source
        grants.push({
          target: step.grant,
          pairs,
          carried,
          ...(recordedUnder ? { source: recordedUnder } : {}),
        })
      }
      continue
    }
    if (typeof step.add === 'string') {
      const target = step.add
      const definition = fields[target]
      if (definition?.type !== 'multiselect') continue
      const allowed = new Set(
        (Array.isArray(definition.options) ? definition.options : [])
          .map(toOption)
          .filter((option): option is PromptOption => !!option)
          .map((option) => option.value)
      )
      const list = Array.isArray(current(target)) ? [...(current(target) as unknown[])] : []
      const held = new Set(list.map(String))
      for (const item of asList(evaluate<symbol>(step.values, ctx, FAILED))) {
        const value = String(item)
        if ((allowed.size && !allowed.has(value)) || held.has(value)) continue
        list.push(value)
        held.add(value)
        granted[target] = [...(granted[target] || []), value]
      }
      patch[target] = list
      continue
    }
    if (typeof step.unpick === 'string') {
      // The list less the entry's row, made as a change by hand, so the row's
      // own grants are taken back; the picks after it see the list without it.
      const field = step.unpick
      if (fields[field]?.type !== 'content_list') continue
      const entry = evaluate<symbol>(step.entry, ctx, FAILED)
      if (!isObject(entry) || typeof entry._ref !== 'string' || !entry._ref) continue
      const wanted = entry._ref.trim().toLowerCase()
      const before = picks.filter((pick) => pick.field === field).pop()
      const rows = before
        ? (before.value as unknown[])
        : Array.isArray(current(field))
          ? (current(field) as unknown[])
          : []
      const index = rows.findIndex(
        (item) =>
          isObject(item) &&
          String(item._ref ?? '')
            .trim()
            .toLowerCase() === wanted
      )
      if (index < 0) continue
      picks.push({ field, value: rows.filter((_, i) => i !== index) })
      // A row this prompt picked and took out again is not recorded either.
      const held = granted[field] || []
      const at = held.indexOf(entry._ref)
      if (at >= 0) granted[field] = held.filter((_, i) => i !== at)
      continue
    }
    if (typeof step.pick === 'string') {
      const field = step.pick
      const definition = fields[field]
      const entry = evaluate<symbol>(step.entry, ctx, FAILED)
      if (!definition || !isObject(entry) || typeof entry._ref !== 'string' || !entry._ref) continue
      const per: Values = {}
      for (const [key, formula] of Object.entries(isObject(step.values) ? step.values : {})) {
        const value = evaluate<symbol>(formula, ctx, FAILED)
        if (value !== FAILED) per[key] = value
      }
      const picked: Values = { _ref: entry._ref }
      if (typeof entry._source === 'string' && entry._source) picked._source = entry._source
      if (Object.keys(per).length) picked._per = per
      if (definition.type === 'content_ref') {
        picks.push({ field, value: picked, entry })
      } else if (definition.type === 'content_list') {
        // Each pick into the same list sees the ones before it.
        const before = picks.filter((pick) => pick.field === field).pop()
        const rows = before
          ? (before.value as unknown[])
          : Array.isArray(current(field))
            ? (current(field) as unknown[])
            : []
        picks.push({ field, value: [...rows, picked], entry })
        granted[field] = [...(granted[field] || []), entry._ref]
      }
    }
  }

  // Recorded under the pick that opened the prompt, so picking something
  // else there takes back what the prompt added along with the pick's own.
  if (source && Object.keys(granted).length) {
    const all = { ...((data?.[GRANTED_KEY] || {}) as Record<string, Record<string, string[]>>) }
    const fromSource = { ...(all[source] || {}) }
    for (const [target, values] of Object.entries(granted)) {
      fromSource[target] = [...(fromSource[target] || []), ...values]
    }
    all[source] = fromSource
    patch[GRANTED_KEY] = all
  }
  return { patch, picks, prompts, grants }
}

/**
 * Make a prompt's grants, as a pick's `grant` rules make theirs: each id the
 * catalog has as the target's content type becomes a reference, any other a
 * freeform entry by its name. What is added is recorded under the grant's
 * source, so picking something else there takes it back.
 *
 * @param data  the character's data with the prompt's own patch laid over it
 */
export async function planGrants(
  grants: PromptGrant[],
  {
    document,
    data,
    lookup,
  }: {
    document: PromptDocument | null | undefined
    data: Values | null | undefined
    lookup?: (ids: string[]) => Promise<ResolvedRefs | null | undefined>
  }
): Promise<Values> {
  const fields = document?.fields || {}
  const wanted = grants
    .filter((grant) => fields[grant.target]?.type === 'content_list')
    .flatMap((grant) => grant.pairs.map(([id]) => id))
    .filter(Boolean)
  let resolved: ResolvedRefs = {}
  if (wanted.length && lookup) {
    try {
      resolved = (await lookup([...new Set(wanted)])) || {}
    } catch {
      // No catalog to ask is the catalog not having it: named entries instead.
      resolved = {}
    }
  }
  const patch: Values = {}
  const all = { ...((data?.[GRANTED_KEY] || {}) as Record<string, Record<string, string[]>>) }
  let recordedAny = false
  for (const grant of grants) {
    const definition = fields[grant.target]
    if (!definition) continue
    const held = grant.target in patch ? patch[grant.target] : data?.[grant.target]
    const added: string[] = []
    const list = grantInto({
      definition,
      list: Array.isArray(held) ? [...held] : [],
      pairs: grant.pairs,
      carried: grant.carried,
      resolved,
      record: (key) => added.push(key),
    })
    if (!list) continue
    patch[grant.target] = list
    if (grant.source && added.length) {
      const fromSource = { ...(all[grant.source] || {}) }
      fromSource[grant.target] = [...(fromSource[grant.target] || []), ...added]
      all[grant.source] = fromSource
      recordedAny = true
    }
  }
  if (recordedAny) patch[GRANTED_KEY] = all
  return patch
}

function samePrompt(a: PromptRequest, b: PromptRequest): boolean {
  return (
    a.prompt === b.prompt &&
    (a.source || '') === (b.source || '') &&
    (a.ref || '') === (b.ref || '')
  )
}

/** A step's heading: its `label_formula` worked out, or else its `label`. */
export function stepLabel(step: PromptStep, context: ExprContext): string {
  if (step.label_formula) {
    const value = evaluate<symbol>(step.label_formula, context, FAILED)
    if (value !== FAILED && value !== null && value !== undefined && String(value).trim()) {
      return String(value)
    }
  }
  return step.label || ''
}

/**
 * The prompt a sheet opens by itself when a character is opened: its
 * `start_prompt`, when its `when` holds and the player has not put it off.
 */
export function startPrompt(
  document: PromptDocument | null | undefined,
  context: Values,
  data: Values | null | undefined
): string | undefined {
  const start = document?.start_prompt
  if (!isObject(start) || typeof start.prompt !== 'string') return undefined
  const prompt = findPrompt(document, start.prompt)
  if (!prompt) return undefined
  if (pendingPrompts(data).some((item) => item.prompt === start.prompt)) return undefined
  if (typeof start.when === 'string' && start.when.trim()) {
    const value = evaluate<symbol>(start.when, context, FAILED)
    if (value === FAILED || !value) return undefined
  }
  return start.prompt
}

/** The prompts the player put off, as stored. */
export function pendingPrompts(data: Values | null | undefined): PromptRequest[] {
  const list = data?.[PENDING_PROMPTS_KEY]
  if (!Array.isArray(list)) return []
  return list.filter(
    (item): item is PromptRequest => isObject(item) && typeof item.prompt === 'string'
  )
}

function stored(request: PromptRequest): PromptRequest {
  const kept: PromptRequest = { prompt: request.prompt }
  if (request.source) kept.source = request.source
  if (request.source && request.ref) kept.ref = request.ref
  return kept
}

/** The patch that keeps a prompt to open later. */
export function withPending(data: Values | null | undefined, request: PromptRequest): Values {
  const list = pendingPrompts(data)
  if (list.some((item) => samePrompt(item, request))) return {}
  return { [PENDING_PROMPTS_KEY]: [...list, stored(request)] }
}

/** The patch that forgets a prompt put off - answered, or dismissed. */
export function withoutPending(data: Values | null | undefined, request: PromptRequest): Values {
  const list = pendingPrompts(data)
  const next = list.filter((item) => !samePrompt(item, request))
  return next.length === list.length ? {} : { [PENDING_PROMPTS_KEY]: next }
}

/** The patch that forgets every prompt a field's pick opened: it was picked again. */
export function withoutPendingFrom(data: Values | null | undefined, source: string): Values {
  const list = pendingPrompts(data)
  const next = list.filter((item) => item.source !== source)
  return next.length === list.length ? {} : { [PENDING_PROMPTS_KEY]: next }
}

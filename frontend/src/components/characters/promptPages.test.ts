import { describe, it, expect } from 'vitest'
import { catalogKey } from './promptCatalog'
import { promptPages, promptState } from './promptPages'
import { entryAnswer } from './sheetPrompts'
import type { PromptStep, SheetPrompt } from './sheetPrompts'

const feat = (id: string, data: Record<string, unknown> = {}) =>
  entryAnswer({ entry_id: id, name: id, source: 'phb', data })

describe('promptPages', () => {
  it('is one page holding every step when the prompt is not paged', () => {
    const prompt: SheetPrompt = {
      label: 'P',
      steps: [
        { key: 'a', type: 'number', page: 'one' },
        { key: 'b', type: 'number' },
      ],
      apply: [],
    }
    expect(promptPages(prompt)).toEqual([{ name: '', keys: ['a', 'b'] }])
  })

  it('pages by name in the order first named, a step without one alone', () => {
    const prompt: SheetPrompt = {
      label: 'P',
      paged: true,
      pages: {
        feat: { label: 'Feat', later: 'feat_later' },
        // Not a page of the prototype's: an own key only.
        constructor: { label: 'Built' },
      },
      steps: [
        { key: 'hp', type: 'number' },
        { key: 'kind', type: 'select', options: ['a'], page: 'feat' },
        { key: 'spells', type: 'number', page: 'spells' },
        { key: 'which', type: 'entry', content_type: 'feat', page: 'feat' },
        { key: 'x', type: 'number', page: 'constructor' },
      ],
      apply: [],
    }
    expect(promptPages(prompt)).toEqual([
      { name: '#hp', keys: ['hp'] },
      { name: 'feat', label: 'Feat', later: 'feat_later', keys: ['kind', 'which'] },
      { name: 'spells', keys: ['spells'] },
      { name: 'constructor', label: 'Built', keys: ['x'] },
    ])
    expect(promptPages({ ...prompt, pages: undefined })[2]).toEqual({
      name: 'spells',
      keys: ['spells'],
    })
  })
})

describe('promptState', () => {
  const FEATS: PromptStep = {
    key: 'feats',
    type: 'entries',
    content_type: 'feat',
    count: 3,
    filter: "entry.needs == '' or has_ref(answer.feats, entry.needs)",
  }
  const CATALOG = [
    feat('a', { needs: '' }),
    feat('b', { needs: 'a' }),
    feat('c', { needs: 'b' }),
    feat('d', { needs: 'z' }),
  ]
  const catalogs = { [catalogKey(FEATS)!]: CATALOG }
  const base = { context: {}, document: {}, data: {}, catalogs }
  const prompt: SheetPrompt = { label: 'P', steps: [FEATS], apply: [] }

  it('offers an option once its prerequisite is picked in the same step', () => {
    const none = promptState(prompt, { ...base, answers: {} })
    expect(none.steps[0].options!.map((e) => e._ref)).toEqual(['a'])
    const withA = promptState(prompt, { ...base, answers: { feats: [CATALOG[0]] } })
    expect(withA.steps[0].options!.map((e) => e._ref)).toEqual(['a', 'b'])
    expect(withA.dropped).toEqual({})
  })

  it('lets go of choices whose prerequisite went, and those resting on them', () => {
    const state = promptState(prompt, { ...base, answers: { feats: [CATALOG[1], CATALOG[2]] } })
    expect(state.dropped).toEqual({ feats: undefined })
    expect(state.answers).toEqual({})
    expect(state.steps[0].options!.map((e) => e._ref)).toEqual(['a'])
  })

  it('needs no more entries than the catalog offers', () => {
    const answers = { feats: [CATALOG[0], CATALOG[1], CATALOG[2]] }
    expect(promptState(prompt, { ...base, answers }).steps[0].answered).toBe(true)
    // Only a, b and c are ever offered: three of them complete a count of four.
    const four: SheetPrompt = { ...prompt, steps: [{ ...FEATS, count: 4 }] }
    expect(promptState(four, { ...base, answers }).steps[0].answered).toBe(true)
    expect(promptState(four, { ...base, answers: { feats: [CATALOG[0]] } }).steps[0].answered).toBe(
      false
    )
  })

  it("follows an earlier step's answer, letting an entry step's choice go", () => {
    const spells: SheetPrompt = {
      label: 'P',
      steps: [
        { key: 'cls', type: 'select', options: ['Wizard', 'Cleric'] },
        { key: 'spell', type: 'entry', content_type: 'spell', filter: 'entry.cls == answer.cls' },
      ],
      apply: [],
    }
    const bolt = entryAnswer({ entry_id: 'bolt', name: 'Bolt', data: { cls: 'Wizard' } })
    const heal = entryAnswer({ entry_id: 'heal', name: 'Heal', data: { cls: 'Cleric' } })
    const reads = { [catalogKey(spells.steps[1])!]: [bolt, heal] }
    const kept = promptState(spells, {
      ...base,
      catalogs: reads,
      answers: { cls: 'Wizard', spell: bolt },
    })
    expect(kept.dropped).toEqual({})
    expect(kept.answers.spell).toBe(bolt)
    const changed = promptState(spells, {
      ...base,
      catalogs: reads,
      answers: { cls: 'Cleric', spell: bolt },
    })
    expect(changed.dropped).toEqual({ spell: undefined })
    expect(changed.steps[1].options!.map((e) => e._ref)).toEqual(['heal'])
    expect(changed.steps[1].answered).toBe(false)
  })

  it('leaves an answer alone while its catalog is read, and says why a read failed', () => {
    const loading = promptState(prompt, { ...base, catalogs: {}, answers: { feats: [CATALOG[2]] } })
    expect(loading.dropped).toEqual({})
    expect(loading.steps[0].options).toBeUndefined()
    expect(loading.steps[0].answered).toBe(false)
    const failed = promptState(prompt, {
      ...base,
      catalogs: { [catalogKey(FEATS)!]: { error: 'Offline' } },
      answers: {},
    })
    expect(failed.steps[0]).toMatchObject({ options: [], failed: 'Offline' })
  })

  it("keeps a skipped page's steps showing but answered by nobody, blocking nothing", () => {
    const paged: SheetPrompt = {
      label: 'P',
      paged: true,
      steps: [
        { key: 'hp', type: 'number' },
        { key: 'kind', type: 'select', options: ['a'], page: 'feat' },
      ],
      apply: [],
    }
    const state = promptState(paged, {
      ...base,
      answers: { hp: 3, kind: 'a' },
      skipped: new Set(['feat']),
    })
    expect(state.steps.map((s) => [s.step.key, s.skipped, s.answered])).toEqual([
      ['hp', false, true],
      ['kind', true, true],
    ])
    expect(state.answers).toEqual({ hp: 3 })
  })

  it('passes over a step its visible_if hides, reading only the answers shown before it', () => {
    const branch: SheetPrompt = {
      label: 'P',
      steps: [
        { key: 'kind', type: 'select', options: ['asi', 'feat'] },
        { key: 'asi', type: 'number', visible_if: "answer.kind == 'asi'" },
      ],
      apply: [],
    }
    const state = promptState(branch, { ...base, answers: { kind: 'feat', asi: 2 } })
    expect(state.steps.map((s) => s.step.key)).toEqual(['kind'])
    expect(state.answers).toEqual({ kind: 'feat' })
  })

  it('waits for its whole count when the catalog could not be read', () => {
    const failed = promptState(prompt, {
      ...base,
      catalogs: { [catalogKey(FEATS)!]: { error: 'Offline' } },
      answers: {},
    })
    expect(failed.steps[0].answered).toBe(false)
  })

  it('keeps nothing ticked once its count works out to nothing', () => {
    const counted: SheetPrompt = {
      label: 'P',
      steps: [
        { key: 'cls', type: 'select', options: ['Wizard', 'Fighter'] },
        { ...FEATS, filter: undefined, count: "answer.cls == 'Wizard' ? 1 : 0" },
      ],
      apply: [],
    }
    const wizard = promptState(counted, {
      ...base,
      answers: { cls: 'Wizard', feats: [CATALOG[0]] },
    })
    expect(wizard.dropped).toEqual({})
    const fighter = promptState(counted, {
      ...base,
      answers: { cls: 'Fighter', feats: [CATALOG[0]] },
    })
    expect(fighter.dropped).toEqual({ feats: undefined })
    expect(fighter.answers).toEqual({ cls: 'Fighter' })
    expect(fighter.steps[1].answered).toBe(true)
  })
})

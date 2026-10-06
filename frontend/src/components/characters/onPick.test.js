import { describe, it, expect, vi } from 'vitest'
import { planPick, applyChoice, fieldState, GRANTED_KEY } from './onPick'

const SKILLS = ['Arcana', 'History', 'Insight', 'Religion', 'Stealth']

const DOCUMENT = {
  fields: {
    klass: {
      type: 'content_ref',
      content_type: 'class',
      on_pick: [{ choose: 'skills', count: 'skill_choices', from: 'skill_options' }],
    },
    background: {
      type: 'content_ref',
      content_type: 'background',
      on_pick: [
        { grant: 'skills', from: 'skill_proficiencies' },
        { grant: 'feats', ref: 'feat_id', name: 'feat' },
      ],
    },
    species: { type: 'content_ref', content_type: 'species' },
    skills: { type: 'multiselect', options: SKILLS },
    feats: { type: 'content_list', content_type: 'feat' },
  },
}

const ACOLYTE = {
  name: 'Acolyte',
  skill_proficiencies: ['Insight', 'Religion'],
  feat_id: 'magic-initiate',
  feat: 'Magic Initiate (Cleric)',
}
const SAGE = {
  name: 'Sage',
  skill_proficiencies: ['Arcana', 'History'],
  feat_id: 'magic-initiate',
  feat: 'Magic Initiate (Wizard)',
}

// The catalog has the feat, as a feat.
const lookupFound = vi.fn(async (ids) =>
  Object.fromEntries(ids.map((id) => [id, { content_type: 'feat', source: 'srd', missing: false }]))
)
const lookupMissing = vi.fn(async (ids) =>
  Object.fromEntries(ids.map((id) => [id, { missing: true }]))
)

describe('planPick — grants', () => {
  it('grants a background its skills', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: lookupFound,
    })
    expect(patch.skills).toEqual(['Insight', 'Religion'])
  })

  it('grants the feat as a reference when the catalog has it', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: lookupFound,
    })
    expect(patch.feats).toEqual([{ _ref: 'magic-initiate', _source: 'srd' }])
  })

  it('falls back to the name when the catalog does not have it', async () => {
    // Content not loaded into Grimoire still says what the player was given.
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: lookupMissing,
    })
    expect(patch.feats).toEqual([{ _inline: true, name: 'Magic Initiate (Cleric)' }])
  })

  it('falls back to the name when there is no catalog to ask', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
    })
    expect(patch.feats).toEqual([{ _inline: true, name: 'Magic Initiate (Cleric)' }])
  })

  it('falls back to the name when the lookup fails', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: async () => {
        throw new Error('offline')
      },
    })
    expect(patch.feats[0]._inline).toBe(true)
  })

  it('does not grant a reference to an entry of another type', async () => {
    // resolve() does not filter by type, and a spell may share a feat's id.
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: async () => ({ 'magic-initiate': { content_type: 'spell', missing: false } }),
    })
    expect(patch.feats).toEqual([{ _inline: true, name: 'Magic Initiate (Cleric)' }])
  })

  it('reads comma-separated text as a list', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: { ...ACOLYTE, skill_proficiencies: 'Insight, Religion' },
    })
    expect(patch.skills).toEqual(['Insight', 'Religion'])
  })

  it('skips a granted value the target does not offer', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: { ...ACOLYTE, skill_proficiencies: ['Insight', 'Basket Weaving'] },
    })
    expect(patch.skills).toEqual(['Insight'])
  })

  it('records what it added', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: ACOLYTE,
      lookup: lookupFound,
    })
    expect(patch[GRANTED_KEY]).toEqual({
      background: { skills: ['Insight', 'Religion'], feats: ['magic-initiate'] },
    })
  })

  it('leaves alone a value the player already had', async () => {
    // Not recorded, so changing background later will not take it away.
    const { patch } = await planPick({
      document: DOCUMENT,
      data: { skills: ['Insight'] },
      field: 'background',
      entry: ACOLYTE,
    })
    expect(patch.skills).toEqual(['Insight', 'Religion'])
    expect(patch[GRANTED_KEY].background.skills).toEqual(['Religion'])
  })

  it('does nothing for a field with no rules', async () => {
    const { patch, choices } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'species',
      entry: { name: 'Elf' },
    })
    expect(patch).toEqual({})
    expect(choices).toEqual([])
  })

  it('reads a freeform entry the player typed', async () => {
    // Homebrew never loaded into Grimoire works the same way.
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'background',
      entry: { _inline: true, name: 'Hedge Knight', skill_proficiencies: ['Stealth'] },
    })
    expect(patch.skills).toEqual(['Stealth'])
  })
})

describe('planPick — changing your mind', () => {
  const afterAcolyte = {
    background: { _ref: 'acolyte' },
    skills: ['Stealth', 'Insight', 'Religion'],
    feats: [{ _ref: 'magic-initiate' }, { _ref: 'tough' }],
    [GRANTED_KEY]: { background: { skills: ['Insight', 'Religion'], feats: ['magic-initiate'] } },
  }

  it('takes the old pick back off before granting the new one', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: afterAcolyte,
      field: 'background',
      entry: SAGE,
      lookup: lookupFound,
    })
    // Stealth was the player's own and stays; Acolyte's two are gone.
    expect(patch.skills).toEqual(['Stealth', 'Arcana', 'History'])
    // The feat the player chose themselves is untouched.
    expect(patch.feats).toEqual([{ _ref: 'tough' }, { _ref: 'magic-initiate', _source: 'srd' }])
  })

  it('takes everything back when the pick is cleared', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: afterAcolyte,
      field: 'background',
      entry: null,
    })
    expect(patch.skills).toEqual(['Stealth'])
    expect(patch.feats).toEqual([{ _ref: 'tough' }])
    expect(patch[GRANTED_KEY]).toEqual({})
  })

  it('removes a granted freeform entry by name', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {
        feats: [{ _inline: true, name: 'Magic Initiate (Cleric)' }],
        [GRANTED_KEY]: { background: { feats: ['Magic Initiate (Cleric)'] } },
      },
      field: 'background',
      entry: null,
    })
    expect(patch.feats).toEqual([])
  })

  it('copes with a grant the player already removed by hand', async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: { ...afterAcolyte, skills: ['Stealth'] },
      field: 'background',
      entry: null,
    })
    expect(patch.skills).toEqual(['Stealth'])
  })

  it("keeps other picks' grants", async () => {
    const { patch } = await planPick({
      document: DOCUMENT,
      data: {
        ...afterAcolyte,
        [GRANTED_KEY]: { ...afterAcolyte[GRANTED_KEY], klass: { skills: ['Stealth'] } },
      },
      field: 'background',
      entry: null,
    })
    expect(patch[GRANTED_KEY]).toEqual({ klass: { skills: ['Stealth'] } })
  })
})

describe('planPick — choices', () => {
  const WIZARD = { name: 'Wizard', skill_choices: 2, skill_options: ['Arcana', 'History'] }

  it('asks for a choice rather than deciding', async () => {
    const { patch, choices } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'klass',
      entry: WIZARD,
    })
    expect(choices).toEqual([
      { source: 'klass', target: 'skills', count: 2, options: ['Arcana', 'History'], label: '' },
    ])
    expect(patch.skills).toBeUndefined()
  })

  it('takes a fixed count as well as one read from the entry', async () => {
    const document = {
      ...DOCUMENT,
      fields: {
        ...DOCUMENT.fields,
        klass: {
          ...DOCUMENT.fields.klass,
          on_pick: [{ choose: 'skills', count: 1, from: 'skill_options', label: 'Pick one' }],
        },
      },
    }
    const { choices } = await planPick({ document, data: {}, field: 'klass', entry: WIZARD })
    expect(choices[0].count).toBe(1)
    expect(choices[0].label).toBe('Pick one')
  })

  it('asks nothing when there is nothing to choose from', async () => {
    const { choices } = await planPick({
      document: DOCUMENT,
      data: {},
      field: 'klass',
      entry: { ...WIZARD, skill_options: [] },
    })
    expect(choices).toEqual([])
  })

  it('records a choice under the pick that asked for it', () => {
    const patch = applyChoice({
      data: { skills: ['Stealth'] },
      choice: { source: 'klass', target: 'skills' },
      picked: ['Arcana', 'Stealth'],
    })
    // Stealth was already there, so it is not re-added or recorded.
    expect(patch.skills).toEqual(['Stealth', 'Arcana'])
    expect(patch[GRANTED_KEY]).toEqual({ klass: { skills: ['Arcana'] } })
  })

  it('so re-picking the class takes the chosen skills back off', async () => {
    const chosen = applyChoice({
      data: {},
      choice: { source: 'klass', target: 'skills' },
      picked: ['Arcana'],
    })
    const { patch } = await planPick({
      document: DOCUMENT,
      data: { klass: { _ref: 'wizard' }, ...chosen },
      field: 'klass',
      entry: null,
    })
    expect(patch.skills).toEqual([])
  })
})

describe('fieldState', () => {
  const derived = { type: 'number', default_from: "ref(species, 'speed')" }

  it('shows the derived value until the player sets one', () => {
    expect(fieldState('speed', derived, {}, { speed: 25 })).toEqual({
      value: 25,
      derived: true,
      overridden: false,
    })
  })

  it("shows the player's value once they set it", () => {
    expect(fieldState('speed', derived, { speed: 40 }, { speed: 40 })).toEqual({
      value: 40,
      derived: false,
      overridden: true,
    })
  })

  it('treats a plain field as neither', () => {
    expect(fieldState('hp', { type: 'number' }, { hp: 7 }, {})).toEqual({
      value: 7,
      derived: false,
      overridden: false,
    })
  })
})

describe('planPick — several entries at once', () => {
  const DOC = {
    fields: {
      species: {
        type: 'content_ref',
        content_type: 'species',
        on_pick: [
          { grant: 'traits', from: 'trait_ids', names: 'traits', carry: { species: 'name' } },
        ],
      },
      traits: { type: 'content_list', content_type: 'trait' },
    },
  }
  const DWARF = {
    name: 'Dwarf',
    trait_ids: 'dwarf-darkvision, dwarf-stonecunning',
    traits: 'Darkvision, Stonecunning',
  }

  it('grants each as a reference when the catalog has it', async () => {
    const { patch } = await planPick({
      document: DOC,
      data: {},
      field: 'species',
      entry: DWARF,
      lookup: async (ids) =>
        Object.fromEntries(
          ids.map((id) => [id, { content_type: 'trait', source: 'srd', missing: false }])
        ),
    })
    expect(patch.traits).toEqual([
      { _ref: 'dwarf-darkvision', _source: 'srd' },
      { _ref: 'dwarf-stonecunning', _source: 'srd' },
    ])
  })

  it('falls back to each name, carrying the source, without the catalog', async () => {
    // Without content installed the player still sees what the species gives,
    // and where it came from.
    const { patch } = await planPick({ document: DOC, data: {}, field: 'species', entry: DWARF })
    expect(patch.traits).toEqual([
      { _inline: true, species: 'Dwarf', name: 'Darkvision' },
      { _inline: true, species: 'Dwarf', name: 'Stonecunning' },
    ])
  })

  it('takes them all back when the species changes', async () => {
    const first = await planPick({ document: DOC, data: {}, field: 'species', entry: DWARF })
    const { patch } = await planPick({
      document: DOC,
      data: { ...first.patch },
      field: 'species',
      entry: null,
    })
    expect(patch.traits).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  addedLinks,
  defaultSelection,
  formatValue,
  intoBookForm,
  isMergedField,
  labelKey,
} from './metadataFieldValue'

describe('formatValue', () => {
  it('renders scalars', () => {
    expect(formatValue('OGL')).toBe('OGL')
    expect(formatValue(2017)).toBe('2017')
  })

  it('renders empty values as an empty string', () => {
    expect(formatValue(null)).toBe('')
    expect(formatValue(undefined)).toBe('')
    expect(formatValue('')).toBe('')
  })

  it('joins plain lists', () => {
    expect(formatValue(['Fantasy', 'Horror'])).toBe('Fantasy, Horror')
  })

  it('renders publishers by name', () => {
    expect(formatValue([{ name: 'Evil Hat', url: 'https://evilhat.com' }])).toBe('Evil Hat')
  })

  it('renders labelled links as "label: url"', () => {
    expect(formatValue([{ label: 'Official site', url: 'https://x.com' }])).toBe(
      'Official site: https://x.com'
    )
  })

  it('falls back to whichever half of a link is present', () => {
    expect(formatValue([{ url: 'https://x.com' }])).toBe('https://x.com')
    expect(formatValue([{ label: 'Store' }])).toBe('Store')
  })

  it('drops empty entries from a list', () => {
    expect(formatValue(['Fantasy', null, ''])).toBe('Fantasy')
  })
})

describe('defaultSelection', () => {
  it('selects only fields the system does not already have', () => {
    const fields = [
      { field: 'year', status: 'only_incoming' },
      { field: 'license', status: 'differs' },
      { field: 'edition', status: 'same' },
    ]
    // `differs` would overwrite a user's value and `same` has nothing to do, so
    // neither is pre-selected.
    expect(defaultSelection(fields)).toEqual(['year'])
  })

  it('returns nothing when there is nothing new', () => {
    expect(defaultSelection([{ field: 'edition', status: 'same' }])).toEqual([])
  })

  it('handles an empty field list', () => {
    expect(defaultSelection([])).toEqual([])
  })
})

describe('labelKey', () => {
  it('maps snake_case API fields onto the camelCase label keys', () => {
    expect(labelKey('system_family')).toBe('systemEditor.systemFamily')
    expect(labelKey('dice_materials')).toBe('systemEditor.diceMaterials')
    expect(labelKey('parent_system')).toBe('systemEditor.parentSystem')
  })

  it('passes through fields whose names already match', () => {
    expect(labelKey('license')).toBe('systemEditor.license')
    expect(labelKey('year')).toBe('systemEditor.year')
  })
})

describe('intoBookForm', () => {
  it('joins array fields into the comma-separated text the editor holds', () => {
    expect(intoBookForm({ authors: ['John Harper', 'Sean Nittner'] })).toEqual({
      authors: 'John Harper, Sean Nittner',
    })
  })

  it('stringifies the date parts', () => {
    // The editor's date inputs are controlled text; a number would break them.
    expect(intoBookForm({ year: 2017, month: 3, day: 14 })).toEqual({
      year: '2017',
      month: '3',
      day: '14',
    })
  })

  it('turns a null date part into an empty string', () => {
    expect(intoBookForm({ year: null })).toEqual({ year: '' })
  })

  it('leaves other fields untouched', () => {
    const fields = { title: 'Blades', genres: ['Fantasy'], urls: [{ label: 'a', url: 'b' }] }
    expect(intoBookForm(fields)).toEqual(fields)
  })

  it('copes with a scalar in an array-valued field', () => {
    expect(intoBookForm({ artists: 'Solo Artist' })).toEqual({ artists: 'Solo Artist' })
  })

  it('handles an empty object', () => {
    expect(intoBookForm({})).toEqual({})
  })
})

describe('isMergedField', () => {
  it('identifies the link lists the server merges', () => {
    expect(isMergedField('urls')).toBe(true)
    expect(isMergedField('character_builder_urls')).toBe(true)
  })

  it('leaves replace-style fields alone', () => {
    expect(isMergedField('genres')).toBe(false)
    expect(isMergedField('license')).toBe(false)
  })
})

describe('addedLinks', () => {
  const MINE = { label: 'My notes', url: 'https://mine.example' }
  const WIKI = { label: 'TTRPG Wiki', url: 'https://ttrpgwiki.com/systems/x' }

  it('returns only what is genuinely new', () => {
    // The merged list contains the user's links too; showing all of them would
    // bury the one link actually being added.
    expect(addedLinks([MINE], [MINE, WIKI])).toEqual([WIKI])
  })

  it('returns everything when there is nothing yet', () => {
    expect(addedLinks([], [WIKI])).toEqual([WIKI])
    expect(addedLinks(null, [WIKI])).toEqual([WIKI])
  })

  it('returns nothing when all links are already present', () => {
    expect(addedLinks([WIKI], [WIKI])).toEqual([])
  })

  it('compares urls case-insensitively', () => {
    const upper = { label: 'X', url: WIKI.url.toUpperCase() }
    expect(addedLinks([upper], [WIKI])).toEqual([])
  })

  it('copes with malformed entries', () => {
    expect(addedLinks([{}], [WIKI])).toEqual([WIKI])
  })
})

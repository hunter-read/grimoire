import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterSheet from './CharacterSheet'
import { entryNoteText, noteEntry, parseEntryNote } from './sheetFormulaContext'

// An `entry_note` reads the candidate beside the character, so the sheet hands
// its context down to the catalog browser however the sheet is laid out.

const mockBrowse = vi.fn()
vi.mock('../../api', () => ({
  content: { browse: (...args: unknown[]) => mockBrowse(...args) },
  characters: {
    portraitUrl: () => '',
    imageUrl: () => '',
  },
}))

const DOCUMENT = {
  fields: {
    mastery_known: { type: 'text', label: 'Masteries', default: 'Sap' },
    weapons: {
      type: 'content_list',
      label: 'Weapons',
      content_type: 'weapon',
      entry_note: "contains(mastery_known, entry.mastery) ? concat(entry.mastery, ' ✓') : ''",
    },
    favourite: {
      type: 'content_ref',
      label: 'Favourite',
      content_type: 'weapon',
      entry_note: 'entry.mastery',
    },
  },
  content_types: {
    weapon: { fields: { name: { type: 'text' }, mastery: { type: 'text' } } },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowse.mockResolvedValue({
    entries: [
      { entry_id: 'mace', source: 'srd', name: 'Mace', data: { mastery: 'Sap' } },
      { entry_id: 'dagger', source: 'srd', name: 'Dagger', data: { mastery: 'Nick' } },
    ],
    total: 2,
    page: 1,
    page_size: 50,
    filters_available: {},
  })
})

describe('entry_note on the sheet', () => {
  it('reads the character in an HTML layout', async () => {
    render(
      <CharacterSheet
        document={{
          ...DOCUMENT,
          layout_ast: [{ tag: 'g-field', attrs: { name: 'weapons' }, children: [] }],
        }}
        data={{}}
        schemaId="demo"
        onChange={vi.fn()}
      />
    )
    await userEvent.click(screen.getByText(/Browse catalog/i))
    expect(await screen.findByText('Sap ✓')).toHaveClass('gc-entry-note')
    expect(screen.queryByText('Nick ✓')).not.toBeInTheDocument()
  })

  it('reads the character in a simple layout, for a single pick', async () => {
    render(
      <CharacterSheet
        document={{ ...DOCUMENT, layout: [{ title: 'Kit', fields: ['favourite'] }] }}
        data={{}}
        schemaId="demo"
        onChange={vi.fn()}
      />
    )
    await userEvent.click(screen.getByLabelText(/Favourite/))
    expect(await screen.findByText('Nick')).toHaveClass('gc-entry-note')
  })
})

describe('entryNoteText', () => {
  it('shows nothing without a note or a sheet', () => {
    const entry = noteEntry({ entry_id: 'mace', name: 'Mace', data: ['odd'] })
    expect(entry).toEqual({ name: 'Mace', _ref: 'mace', _source: undefined })
    expect(entryNoteText(null, entry, null)).toBe('')
    expect(entryNoteText(parseEntryNote('entry._ref'), entry, null)).toBe('mace')
    expect(parseEntryNote('')).toBeNull()
    expect(parseEntryNote(3)).toBeNull()
  })
})

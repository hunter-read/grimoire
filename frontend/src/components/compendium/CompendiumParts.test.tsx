import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompendiumCredits from './CompendiumCredits'
import CompendiumResultList from './CompendiumResultList'
import SystemSheetLinks from './SystemSheetLinks'
import { compendiumEntryPath, compendiumPath, compendiumTypePath } from './compendiumPaths'
import { PACK, entry } from '../../test/compendiumFixtures'

describe('compendiumPaths', () => {
  it('builds paths under the system, encoding ids', () => {
    const ref = { systemId: 's1', gameType: 'ttrpg' }
    expect(compendiumPath(ref)).toBe('/library/system/s1/compendium')
    expect(compendiumTypePath(ref, 'magic item')).toBe('/library/system/s1/compendium/magic%20item')
    expect(compendiumEntryPath(ref, 'spell', 'a/b')).toBe(
      '/library/system/s1/compendium/spell/a%2Fb'
    )
    expect(compendiumEntryPath(ref, 'spell', 'x', 'ruleset:r1')).toBe(
      '/library/system/s1/compendium/spell/x?origin=ruleset%3Ar1'
    )
  })
})

describe('CompendiumCredits', () => {
  it('credits each installed pack, verbatim', () => {
    render(
      <CompendiumCredits
        packs={[
          PACK,
          { ...PACK, pack_id: 'plain', name: 'Plain', license: 'OGL', license_url: '' },
          { pack_id: 'gone', name: 'gone', installed: false, attribution: 'never shown' },
        ]}
      />
    )
    expect(screen.getByRole('contentinfo', { name: 'Credits' })).toBeInTheDocument()
    expect(screen.getAllByText('This work includes material from the Demo SRD.')).toHaveLength(2)
    expect(screen.getByText(/OGL/)).toBeInTheDocument()
    expect(screen.queryByText('never shown')).toBeNull()
  })

  it('renders nothing with nothing to credit', () => {
    const { container } = render(<CompendiumCredits packs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CompendiumResultList', () => {
  it('links each result into the first system it is in, naming type and system', () => {
    render(
      <MemoryRouter>
        <CompendiumResultList
          results={[
            {
              ...entry({ ruleset: true, ruleset_name: 'House', origin: 'ruleset:r1' }),
              type_label: 'Spell',
              systems: [
                { id: 's2', name: 'D&D 5e' },
                { id: 's3', name: 'D&D 2024' },
              ],
            },
            { ...entry({ entry_id: 'lost' }), type_label: 'Spell', systems: [] },
          ]}
          showType
          showSystem
        />
      </MemoryRouter>
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute(
      'href',
      '/library/system/s2/compendium/spell/fireball?origin=ruleset%3Ar1'
    )
    expect(links[0]).toHaveTextContent('Spell · Evocation 3 · from House · D&D 5e, D&D 2024')
  })
})

describe('SystemSheetLinks', () => {
  it('offers a new character on each sheet the reader has', () => {
    render(
      <MemoryRouter>
        <SystemSheetLinks
          sheets={[
            { schema_id: 'dnd 5e', name: 'D&D 5e', available: true, server_wide: true },
            { schema_id: 'other', name: 'Other sheet', available: false },
          ]}
        />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'D&D 5e' })).toHaveAttribute(
      'href',
      '/characters?new=dnd%205e'
    )
    expect(screen.getByText('Other sheet')).toHaveAttribute(
      'title',
      'You do not have this sheet installed'
    )
  })

  it('renders nothing with no sheets', () => {
    const { container } = render(<SystemSheetLinks sheets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

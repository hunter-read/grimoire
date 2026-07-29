import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagTypeSection from './TagTypeSection'

// User-prefs persistence is exercised; keep it in-memory and simple.
let prefs = {}
vi.mock('../../hooks/useUserPrefs', () => ({
  getUserPrefs: () => prefs,
  saveUserPref: (key, value) => {
    prefs[key] = value
  },
}))
vi.mock('../../hooks/useViewMode', () => ({
  getDefaultViewMode: () => 'card',
}))

beforeEach(() => {
  prefs = {}
})

const renderItem = (item) => (
  <div key={item.item_id} data-testid="item">
    {item.item_id}
  </div>
)

describe('TagTypeSection', () => {
  it('renders directly-tagged items under the section title', () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[{ item_id: 'm1' }]}
        folders={[]}
        renderItem={renderItem}
      />
    )
    expect(screen.getByText('Maps')).toBeInTheDocument()
    expect(screen.getByTestId('item')).toHaveTextContent('m1')
  })

  it('nests folder groups beneath the type, title-casing the folder path', () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[]}
        folders={[{ resource_type: 'map', path: 'deep/woods', items: [{ item_id: 'mf1' }] }]}
        renderItem={renderItem}
      />
    )
    // Each path segment is Title-Cased and joined with " / ".
    expect(screen.getByText('Deep / Woods')).toBeInTheDocument()
    expect(screen.getByTestId('item')).toHaveTextContent('mf1')
  })

  it('collapses and expands, persisting the collapse state', async () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[{ item_id: 'm1' }]}
        folders={[]}
        renderItem={renderItem}
      />
    )
    expect(screen.getByTestId('item')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /maps/i }))
    expect(screen.queryByTestId('item')).not.toBeInTheDocument()
    expect(prefs.tagsSectionCollapsed.map).toBe(true)
  })
})

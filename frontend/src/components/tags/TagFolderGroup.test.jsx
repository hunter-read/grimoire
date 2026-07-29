import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagFolderGroup from './TagFolderGroup'

let prefs = {}
vi.mock('../../hooks/useUserPrefs', () => ({
  getUserPrefs: () => prefs,
  saveUserPref: (key, value) => {
    prefs[key] = value
  },
}))

beforeEach(() => {
  prefs = {}
})

const renderItem = (item) => (
  <div key={item.item_id} data-testid="item">
    {item.item_id}
  </div>
)
const containerStyle = { display: 'grid' }

describe('TagFolderGroup', () => {
  it('title-cases each path segment and renders its items', () => {
    render(
      <TagFolderGroup
        resourceType="map"
        path="deep/woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
      />
    )
    expect(screen.getByText('Deep / Woods')).toBeInTheDocument()
    expect(screen.getByTestId('item')).toHaveTextContent('mf1')
  })

  it('collapses and expands, persisting per folder key', async () => {
    render(
      <TagFolderGroup
        resourceType="map"
        path="woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
      />
    )
    expect(screen.getByTestId('item')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /woods/i }))
    expect(screen.queryByTestId('item')).not.toBeInTheDocument()
    expect(prefs.tagsFolderCollapsed['map:woods']).toBe(true)
  })

  it('starts collapsed when its key is already collapsed in prefs', () => {
    prefs = { tagsFolderCollapsed: { 'map:woods': true } }
    render(
      <TagFolderGroup
        resourceType="map"
        path="woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
      />
    )
    expect(screen.queryByTestId('item')).not.toBeInTheDocument()
  })
})

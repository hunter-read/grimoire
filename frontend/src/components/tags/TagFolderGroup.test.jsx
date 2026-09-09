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

describe('TagFolderGroup download (issue #401)', () => {
  it('requests an archive scoped to this folder', async () => {
    const onDownload = vi.fn()
    render(
      <TagFolderGroup
        resourceType="map"
        path="deep/woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
        tag="spooky"
        onDownload={onDownload}
      />
    )
    await userEvent.click(screen.getByTitle('Download Deep / Woods'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          type: 'tag_folder',
          tag: 'spooky',
          resource_type: 'map',
          folder: 'deep/woods',
        },
      })
    )
  })

  it('does not toggle the folder when the download button is clicked', async () => {
    const onDownload = vi.fn()
    render(
      <TagFolderGroup
        resourceType="map"
        path="woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
        tag="spooky"
        onDownload={onDownload}
      />
    )
    await userEvent.click(screen.getByTitle('Download Woods'))
    // The items stay visible: downloading is not a collapse.
    expect(screen.getByTestId('item')).toBeInTheDocument()
  })

  it('offers no download for an empty folder', () => {
    render(
      <TagFolderGroup
        resourceType="map"
        path="woods"
        items={[]}
        containerStyle={containerStyle}
        renderItem={renderItem}
        tag="spooky"
        onDownload={vi.fn()}
      />
    )
    expect(screen.queryByTitle('Download Woods')).not.toBeInTheDocument()
  })

  it('offers no download without a handler', () => {
    render(
      <TagFolderGroup
        resourceType="map"
        path="woods"
        items={[{ item_id: 'mf1' }]}
        containerStyle={containerStyle}
        renderItem={renderItem}
        tag="spooky"
      />
    )
    expect(screen.queryByTitle('Download Woods')).not.toBeInTheDocument()
  })
})

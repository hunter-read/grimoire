import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import FolderTagRow from './FolderTagRow'

vi.mock('../maps/InlineTagEditor', () => ({
  default: ({ tags }) => <div data-testid="editor">{tags.join(',')}</div>,
}))

const renderRow = (props = {}) =>
  render(
    <MemoryRouter>
      <FolderTagRow tags={[]} editing={false} canTag={false} i18n="maps" {...props} />
    </MemoryRouter>
  )

describe('FolderTagRow', () => {
  it('renders each tag as a link to the tags page filtered to it', () => {
    renderRow({ tags: ['city watch', 'urban'] })

    expect(screen.getByRole('link', { name: 'City watch' })).toHaveAttribute(
      'href',
      '/tags?tag=city%20watch'
    )
    expect(screen.getByRole('link', { name: 'Urban' })).toHaveAttribute('href', '/tags?tag=urban')
  })

  it('links by the lowercased internal key regardless of the label casing', () => {
    renderRow({ tags: ['Fall Of Blackbottom'] })

    expect(screen.getByRole('link')).toHaveAttribute('href', '/tags?tag=fall%20of%20blackbottom')
  })

  // The folder header is itself clickable (it collapses the group), so the tag
  // link must not also trigger the collapse behind it.
  it('does not bubble a tag click to the surrounding folder header', async () => {
    const onHeaderClick = vi.fn()
    render(
      <MemoryRouter>
        <div onClick={onHeaderClick}>
          <FolderTagRow tags={['urban']} editing={false} canTag={false} i18n="maps" />
        </div>
      </MemoryRouter>
    )

    await userEvent.click(screen.getByRole('link', { name: 'Urban' }))

    expect(onHeaderClick).not.toHaveBeenCalled()
  })

  it('renders the editor instead of the pills while editing', () => {
    renderRow({ tags: ['urban'], editing: true })

    expect(screen.getByTestId('editor')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the add/edit button only when tagging is allowed', async () => {
    const onEdit = vi.fn()
    const { unmount } = renderRow({ tags: [], canTag: true, onEdit })
    await userEvent.click(screen.getByRole('button'))
    expect(onEdit).toHaveBeenCalled()
    unmount()

    renderRow({ tags: ['urban'], canTag: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

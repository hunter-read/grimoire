import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagSection from './TagSection'

describe('TagSection', () => {
  it('renders the label and tag pills', () => {
    render(<TagSection label="Tags" tags={['forest', 'cave']} noTagsLabel="None" />)
    expect(screen.getByText('Tags')).toBeInTheDocument()
    expect(screen.getByText('forest')).toBeInTheDocument()
    expect(screen.getByText('cave')).toBeInTheDocument()
  })

  it('shows the no-tags label when empty', () => {
    render(<TagSection label="Tags" tags={[]} noTagsLabel="No tags yet" />)
    expect(screen.getByText('No tags yet')).toBeInTheDocument()
  })

  it('renders an edit button when editable and fires onEdit', async () => {
    const onEdit = vi.fn()
    render(
      <TagSection
        label="Tags"
        tags={[]}
        canEdit
        editLabel="Edit"
        noTagsLabel="None"
        onEdit={onEdit}
      />
    )
    await userEvent.click(screen.getByText('Edit'))
    expect(onEdit).toHaveBeenCalled()
  })

  it('hides the edit button when not editable', () => {
    render(<TagSection label="Tags" tags={[]} editLabel="Edit" noTagsLabel="None" />)
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })
})

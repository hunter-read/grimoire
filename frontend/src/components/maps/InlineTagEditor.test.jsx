import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InlineTagEditor from './InlineTagEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'inlineTagEditor.placeholder': 'Add tag',
        'inlineTagEditor.removeTag': `Remove ${o?.tag}`,
        'common.done': 'Done',
      })[k] || k,
  }),
}))

// Drives InlineTagEditor with live tag state so onSave updates are visible.
function Harness({ initial = [], suggestions = [], onCancel = () => {} }) {
  const [tags, setTags] = useState(initial)
  return (
    <div>
      <InlineTagEditor tags={tags} onSave={setTags} onCancel={onCancel} suggestions={suggestions} />
      <output data-testid="tags">{JSON.stringify(tags)}</output>
    </div>
  )
}

const input = () => screen.getByLabelText('Add tag')

describe('InlineTagEditor', () => {
  it('renders existing tags and focuses the input', () => {
    render(<Harness initial={['osr']} />)
    expect(screen.getByText('osr')).toBeInTheDocument()
    expect(input()).toHaveFocus()
  })

  it('adds a lowercased tag on Enter', async () => {
    render(<Harness />)
    await userEvent.type(input(), 'Fantasy{Enter}')
    expect(screen.getByTestId('tags').textContent).toBe('["fantasy"]')
  })

  it('adds on comma and ignores duplicates', async () => {
    render(<Harness initial={['osr']} />)
    await userEvent.type(input(), 'osr,')
    expect(screen.getByTestId('tags').textContent).toBe('["osr"]')
  })

  it('removes a tag via its button', async () => {
    render(<Harness initial={['keep', 'drop']} />)
    await userEvent.click(screen.getByLabelText('Remove drop'))
    expect(screen.getByTestId('tags').textContent).toBe('["keep"]')
  })

  it('removes the last tag on Backspace when the input is empty', () => {
    render(<Harness initial={['a', 'b']} />)
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(screen.getByTestId('tags').textContent).toBe('["a"]')
  })

  it('shows filtered suggestions and commits one via mouse', async () => {
    render(<Harness suggestions={['forest', 'fortress', 'cave']} />)
    await userEvent.type(input(), 'for')
    expect(screen.getByText('forest')).toBeInTheDocument()
    expect(screen.getByText('fortress')).toBeInTheDocument()
    expect(screen.queryByText('cave')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('fortress'))
    expect(screen.getByTestId('tags').textContent).toContain('fortress')
  })

  it('navigates suggestions with arrows and commits the active one on Enter', async () => {
    render(<Harness suggestions={['forest', 'fortress']} />)
    await userEvent.type(input(), 'for')
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // → forest
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // → fortress
    fireEvent.keyDown(input(), { key: 'ArrowUp' }) // back to forest
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('tags').textContent).toBe('["forest"]')
  })

  it('Escape clears open suggestions but keeps the editor', async () => {
    const onCancel = vi.fn()
    render(<Harness suggestions={['forest']} onCancel={onCancel} />)
    await userEvent.type(input(), 'for')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByText('forest')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Escape with no suggestions cancels the editor', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('Done commits the pending input and cancels', async () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    await userEvent.type(input(), 'zine')
    await userEvent.click(screen.getByText('Done'))
    expect(screen.getByTestId('tags').textContent).toBe('["zine"]')
    expect(onCancel).toHaveBeenCalled()
  })
})

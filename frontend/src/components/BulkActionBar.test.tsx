import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BulkActionBar from './BulkActionBar'

describe('BulkActionBar', () => {
  it('applies the typed tags and clears the input', async () => {
    const onApplyTags = vi.fn().mockResolvedValue(undefined)
    render(<BulkActionBar count={2} onApplyTags={onApplyTags} onDone={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Dungeon, Maps' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onApplyTags).toHaveBeenCalledWith(['dungeon', 'maps'])
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error and keeps the typed tags when applying them fails', async () => {
    const onApplyTags = vi.fn().mockRejectedValue(new Error('Tagging failed'))
    render(<BulkActionBar count={2} onApplyTags={onApplyTags} onDone={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'dungeon' } })
    fireEvent.click(screen.getByRole('button', { name: /add tags/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tagging failed')
    expect(input).toHaveValue('dungeon')
  })
})

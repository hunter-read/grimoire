import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetEmailInline from './SetEmailInline'

describe('SetEmailInline', () => {
  it('saves the trimmed value and closes in non-persistent mode', async () => {
    const onSave = vi.fn().mockResolvedValue()
    const onCancel = vi.fn()
    render(<SetEmailInline initial="a@b.com" onSave={onSave} onCancel={onCancel} />)
    fireEvent.change(screen.getByLabelText('user@example.com'), {
      target: { value: '  new@b.com  ' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('new@b.com'))
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
  })

  it('stays open and shows a saved hint in persistent mode', async () => {
    const onSave = vi.fn().mockResolvedValue()
    const onCancel = vi.fn()
    render(<SetEmailInline initial="a@b.com" onSave={onSave} onCancel={onCancel} persistent />)
    // No cancel button in persistent mode.
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows an error when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('bad email'))
    render(<SetEmailInline initial="a@b.com" onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText('bad email')).toBeInTheDocument()
  })

  it('cancels on Escape in non-persistent mode', () => {
    const onCancel = vi.fn()
    render(<SetEmailInline initial="" onSave={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('user@example.com'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})

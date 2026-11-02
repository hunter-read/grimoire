import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetEmailInline from './SetEmailInline'

describe('SetEmailInline', () => {
  it('saves the trimmed value and closes in non-persistent mode', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
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
    const onSave = vi.fn().mockResolvedValue(undefined)
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

describe('SetEmailInline accessibility', () => {
  it('ties a failure to the field as an alert', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('bad email'))
    render(<SetEmailInline initial="a@b.com" onSave={onSave} onCancel={vi.fn()} persistent />)
    fireEvent.click(screen.getByText('Save'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('bad email')
    const field = screen.getByLabelText('user@example.com')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', alert.id)
  })

  it('announces a save from an always-present status', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SetEmailInline initial="a@b.com" onSave={onSave} onCancel={vi.fn()} persistent />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('')
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(status).toHaveTextContent('Saved'))
  })

  it("takes focus only when opened on purpose, and never fills in the admin's own email", () => {
    const { unmount } = render(
      <SetEmailInline initial="" onSave={vi.fn()} onCancel={vi.fn()} persistent />
    )
    const field = screen.getByLabelText('user@example.com')
    expect(field).not.toHaveFocus()
    expect(field).toHaveAttribute('autocomplete', 'off')
    unmount()
    render(<SetEmailInline initial="" onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('user@example.com')).toHaveFocus()
  })
})

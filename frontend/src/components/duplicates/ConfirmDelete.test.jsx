import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmDelete from './ConfirmDelete'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const props = (extra = {}) => ({
  busy: false,
  deleteFile: false,
  onToggleFile: vi.fn(),
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...extra,
})

describe('ConfirmDelete', () => {
  it('leaves the file on disk unless the box is ticked', () => {
    render(<ConfirmDelete {...props()} />)
    // These are irreplaceable purchased files, so keeping them is the default.
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('reports the opt-in to delete from disk', async () => {
    const onToggleFile = vi.fn()
    render(<ConfirmDelete {...props({ onToggleFile })} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggleFile).toHaveBeenCalledWith(true)
  })

  it('confirms and cancels', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDelete {...props({ onConfirm, onCancel })} />)
    await userEvent.click(screen.getByRole('button', { name: /common.delete/ }))
    expect(onConfirm).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /common.cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables confirmation while a request is in flight', () => {
    render(<ConfirmDelete {...props({ busy: true })} />)
    expect(screen.getByRole('button', { name: /common.delete/ })).toBeDisabled()
  })
})

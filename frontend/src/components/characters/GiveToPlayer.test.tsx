import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GiveToPlayer from './GiveToPlayer'

const mockTransfer = vi.fn()

vi.mock('../../api', () => ({
  characters: { transfer: (...a: unknown[]) => mockTransfer(...a) },
}))

const PLAYERS = [
  { user_id: 'u1', name: 'Robin' },
  { user_id: 'u2', name: 'Sam' },
]

const renderPicker = (players = PLAYERS) => {
  const onTransferred = vi.fn()
  const onError = vi.fn()
  render(
    <GiveToPlayer
      character={{ id: 'c1', name: 'Pregen', transfer_candidates: players }}
      onTransferred={onTransferred}
      onError={onError}
    />
  )
  return { onTransferred, onError }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GiveToPlayer', () => {
  it('is not offered when there is nobody to give it to', () => {
    renderPicker([])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('lists the players at the table', () => {
    renderPicker()
    const picker = screen.getByRole('combobox', { name: 'Give to player…' })
    expect(picker).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Sam' })).toBeInTheDocument()
  })

  it('hands the character over once confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const updated = { id: 'c1', owned: false }
    mockTransfer.mockResolvedValue(updated)
    const { onTransferred } = renderPicker()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'u1')
    expect(confirm.mock.calls[0][0]).toMatch(/Give Pregen to Robin\?/)
    await waitFor(() => expect(onTransferred).toHaveBeenCalledWith(updated))
    expect(mockTransfer).toHaveBeenCalledWith('c1', 'u1')
  })

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPicker()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'u2')
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('reports a refused transfer', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockTransfer.mockRejectedValue(new Error('Not at your table'))
    const { onError } = renderPicker()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'u2')
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Not at your table'))
  })
})

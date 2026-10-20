import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GmEditAccess from './GmEditAccess'
import type { Schema } from '../../api'

const mockUpdate = vi.fn()

vi.mock('../../api', () => ({
  characters: { update: (...a: unknown[]) => mockUpdate(...a) },
}))

type Character = Schema<'CharacterDetail'>

const CHARACTER = {
  id: 'c1',
  name: 'Vex',
  schema_ref: 'dnd-5e',
  owned: true,
  editable: true,
  campaign_id: 'camp1',
  campaign_has_gm: true,
  gm_can_edit: false,
} as Character

const renderToggle = (character: Partial<Character> = {}) => {
  const onChanged = vi.fn()
  const onError = vi.fn()
  render(
    <GmEditAccess
      character={{ ...CHARACTER, ...character }}
      onChanged={onChanged}
      onError={onError}
    />
  )
  return { onChanged, onError }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GmEditAccess', () => {
  it('is off by default', () => {
    renderToggle()
    expect(screen.getByLabelText('Let the GM edit')).not.toBeChecked()
  })

  it('reflects access already given', () => {
    renderToggle({ gm_can_edit: true })
    expect(screen.getByLabelText('Let the GM edit')).toBeChecked()
  })

  it('saves the change and hands back the updated character', async () => {
    const updated = { ...CHARACTER, gm_can_edit: true }
    mockUpdate.mockResolvedValue(updated)
    const { onChanged } = renderToggle()
    await userEvent.click(screen.getByLabelText('Let the GM edit'))
    expect(mockUpdate).toHaveBeenCalledWith('c1', { gm_can_edit: true })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated))
  })

  it('turns access back off', async () => {
    mockUpdate.mockResolvedValue({ ...CHARACTER, gm_can_edit: false })
    renderToggle({ gm_can_edit: true })
    await userEvent.click(screen.getByLabelText('Let the GM edit'))
    expect(mockUpdate).toHaveBeenCalledWith('c1', { gm_can_edit: false })
  })

  it('surfaces a failure', async () => {
    mockUpdate.mockRejectedValue(new Error('Nope'))
    const { onChanged, onError } = renderToggle()
    await userEvent.click(screen.getByLabelText('Let the GM edit'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Nope'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('is not offered when the campaign has no GM but the player', () => {
    renderToggle({ campaign_has_gm: false })
    expect(screen.queryByLabelText('Let the GM edit')).not.toBeInTheDocument()
  })

  it('is not offered to anyone but the player', () => {
    renderToggle({ owned: false })
    expect(screen.queryByLabelText('Let the GM edit')).not.toBeInTheDocument()
  })
})

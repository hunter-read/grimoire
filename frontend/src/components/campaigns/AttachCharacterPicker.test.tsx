import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AttachCharacterPicker from './AttachCharacterPicker'

const mockList = vi.fn()
const mockUpdate = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    list: (...a: unknown[]) => mockList(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}))

const renderPicker = (onAttached = vi.fn()) => {
  render(
    <MemoryRouter>
      <AttachCharacterPicker campaignId="camp" onAttached={onAttached} />
    </MemoryRouter>
  )
  return onAttached
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AttachCharacterPicker', () => {
  it('offers the viewer’s characters not already here, active ones first', async () => {
    mockList.mockResolvedValue({
      characters: [
        { id: 'a', name: 'Ghost', schema_ref: 'demo', status: 'dead', owned: true },
        { id: 'b', name: '', schema_ref: 'demo', schema_name: 'Demo', owned: true },
        { id: 'c', name: 'Here', schema_ref: 'demo', owned: true, campaign_id: 'camp' },
        { id: 'd', name: 'Theirs', schema_ref: 'demo', owned: false },
      ],
    })
    renderPicker()
    const options = await screen.findAllByRole('button')
    expect(options.map((o) => o.textContent)).toEqual([
      'Untitled characterDemo',
      'Ghostdemo · Dead',
    ])
  })

  it('points to the Characters page when there is nothing to add', async () => {
    mockList.mockResolvedValue({ characters: [] })
    renderPicker()
    expect(await screen.findByRole('link', { name: 'Go to Characters' })).toHaveAttribute(
      'href',
      '/characters'
    )
  })

  it('reports a failed load', async () => {
    mockList.mockRejectedValue(new Error('Offline'))
    renderPicker()
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  })

  it('reports a refused move and stays open', async () => {
    const user = userEvent.setup()
    mockList.mockResolvedValue({
      characters: [{ id: 'a', name: 'Vex', schema_ref: 'demo', owned: true }],
    })
    mockUpdate.mockRejectedValue(new Error('You are not in that campaign'))
    const onAttached = renderPicker()
    await user.click(await screen.findByRole('button', { name: /Vex/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not in that campaign')
    expect(onAttached).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Vex/ })).toBeEnabled()
  })
})

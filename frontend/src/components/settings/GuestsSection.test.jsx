import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GuestsSection from './GuestsSection'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

import api from '../../api'

const guests = [
  {
    id: 'guest-1',
    display_name: 'Ivy',
    campaign_id: 'camp-1',
    campaign_name: 'Curse of Strahd',
    invited_by: 'DM Dave',
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue(guests)
})

const expand = async () => {
  render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /guests/i }))
  await screen.findByText('Ivy')
}

describe('GuestsSection', () => {
  it('lazy-loads guests only when expanded', async () => {
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    expect(api.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/guests'))
  })

  it('renders a row with name, campaign, and inviter', async () => {
    await expand()
    expect(screen.getByText('Ivy')).toBeInTheDocument()
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.getByText('DM Dave')).toBeInTheDocument()
  })

  it('shows the empty state when there are no guests', async () => {
    api.get.mockResolvedValue([])
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText(/no guests/i)
  })

  it('converts a guest and reports the new user upward', async () => {
    const converted = { id: 'guest-1', username: 'ivy_perm', role: 'player' }
    api.post.mockResolvedValue(converted)
    const onConverted = vi.fn()
    render(<GuestsSection passwordAuthEnabled onConverted={onConverted} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')

    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'ivy_perm' },
    })
    fireEvent.change(screen.getByPlaceholderText(/new password/i), {
      target: { value: 'supersecret1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/guest-1/convert', {
        username: 'ivy_perm',
        role: 'player',
        password: 'supersecret1',
      })
    )
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith(converted))
    // Row is removed once converted.
    expect(screen.queryByText('Ivy')).toBeNull()
  })

  it('omits the password field when password auth is disabled', async () => {
    render(<GuestsSection passwordAuthEnabled={false} onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')
    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    expect(screen.queryByPlaceholderText(/new password/i)).toBeNull()
  })

  it('shows an error when conversion fails', async () => {
    api.post.mockRejectedValue({ body: { detail: 'Username already exists' } })
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')
    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByPlaceholderText(/new password/i), {
      target: { value: 'supersecret1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))
    await screen.findByText('Username already exists')
  })
})

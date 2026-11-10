import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LeagueGuests from './LeagueGuests'

const api = {
  listGuests: vi.fn(),
  createGuest: vi.fn(),
  regenerateGuestCode: vi.fn(),
  removeGuest: vi.fn(),
  guestShareTemplate: vi.fn(),
}

vi.mock('../../api', () => ({
  leagues: {
    listGuests: (...a: unknown[]) => api.listGuests(...a),
    createGuest: (...a: unknown[]) => api.createGuest(...a),
    regenerateGuestCode: (...a: unknown[]) => api.regenerateGuestCode(...a),
    removeGuest: (...a: unknown[]) => api.removeGuest(...a),
    guestShareTemplate: (...a: unknown[]) => api.guestShareTemplate(...a),
  },
}))

const recruit = { user_id: 'g1', nickname: 'Recruit', guest_code: 'ABCDE12345', army: null }
const merged = { user_id: 'g2', nickname: 'Shared', guest_code: null, army: null }

beforeEach(() => {
  vi.clearAllMocks()
  api.listGuests.mockResolvedValue([recruit, merged])
  api.createGuest.mockResolvedValue(recruit)
  api.regenerateGuestCode.mockResolvedValue(recruit)
  api.removeGuest.mockResolvedValue(undefined)
  api.guestShareTemplate.mockResolvedValue({
    code: 'ABCDE12345',
    link: 'https://x/guest?code=ABCDE12345',
    message: 'Join the league',
    mailto_url: 'mailto:?x',
    discord_message: 'Join the league',
  })
})

describe('LeagueGuests', () => {
  it('lists guests and their codes, and hides a code an admin manages', async () => {
    render(<LeagueGuests leagueId="l1" onChanged={vi.fn()} />)
    expect(await screen.findByText('ABCDE12345')).toBeInTheDocument()
    expect(screen.getByText(/an admin manages their code/)).toBeInTheDocument()
    // No share or new code for the guest whose code is the admin's.
    expect(screen.getAllByRole('button', { name: /Share the invite/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Make a new code/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Remove guest/ })).toHaveLength(2)
  })

  it('invites a guest and tells the page', async () => {
    const onChanged = vi.fn()
    api.listGuests.mockResolvedValueOnce([])
    render(<LeagueGuests leagueId="l1" onChanged={onChanged} />)
    expect(await screen.findByText('No guests yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Guest nickname'), { target: { value: ' Recruit ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite guest' }))
    await waitFor(() => expect(api.createGuest).toHaveBeenCalledWith('l1', 'Recruit'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(await screen.findByText('ABCDE12345')).toBeInTheDocument()
  })

  it('regenerates, shares and removes', async () => {
    const onChanged = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<LeagueGuests leagueId="l1" onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new code for Recruit' }))
    await waitFor(() => expect(api.regenerateGuestCode).toHaveBeenCalledWith('l1', 'g1'))

    fireEvent.click(screen.getByRole('button', { name: 'Share the invite for Recruit' }))
    expect(await screen.findByDisplayValue('Join the league')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove guest Shared' }))
    await waitFor(() => expect(api.removeGuest).toHaveBeenCalledWith('l1', 'g2'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('keeps a guest when removal is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<LeagueGuests leagueId="l1" onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove guest Recruit' }))
    expect(api.removeGuest).not.toHaveBeenCalled()
  })

  it('says why a change failed', async () => {
    api.regenerateGuestCode.mockRejectedValue(new Error('Guest access is disabled on this server'))
    api.guestShareTemplate.mockRejectedValue(new Error('No share'))
    render(<LeagueGuests leagueId="l1" onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new code for Recruit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Guest access is disabled')
    fireEvent.click(screen.getByRole('button', { name: 'Share the invite for Recruit' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No share'))
  })

  it('reads a failed list as none', async () => {
    api.listGuests.mockRejectedValue(new Error('nope'))
    render(<LeagueGuests leagueId="l1" onChanged={vi.fn()} />)
    expect(await screen.findByText('No guests yet.')).toBeInTheDocument()
  })
})

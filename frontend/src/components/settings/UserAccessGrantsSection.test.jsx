import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserAccessGrantsSection from './UserAccessGrantsSection'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

function mockApi({ grants = [], systems = [], books = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url.includes('access-grants')) return Promise.resolve(grants)
    if (url.startsWith('/systems')) return Promise.resolve(systems)
    if (url.startsWith('/books')) return Promise.resolve({ books })
    return Promise.resolve([])
  })
  api.post.mockResolvedValue({})
  api.delete.mockResolvedValue({})
}

beforeEach(() => vi.clearAllMocks())

describe('UserAccessGrantsSection', () => {
  it('explains why a player cannot hold grants', async () => {
    mockApi()
    render(<UserAccessGrantsSection userId="u1" userRole="player" />)
    expect(await screen.findByText('access.grants.gmOnly')).toBeInTheDocument()
    // No point querying the API for a role that can never hold a grant.
    expect(api.get).not.toHaveBeenCalled()
  })

  it('explains why an admin cannot hold grants', async () => {
    mockApi()
    render(<UserAccessGrantsSection userId="u1" userRole="admin" />)
    expect(await screen.findByText('access.grants.gmOnly')).toBeInTheDocument()
  })

  it('lists a GM existing grants', async () => {
    mockApi({
      grants: [
        { id: 'g1', scope_type: 'system', scope_id: 's1', scope_name: 'D&D 5e', level: 'admin' },
      ],
    })
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    expect(await screen.findByText(/D&D 5e/)).toBeInTheDocument()
  })

  it('shows a placeholder for a grant whose target was deleted', async () => {
    mockApi({
      grants: [{ id: 'g1', scope_type: 'book', scope_id: 'b1', scope_name: '', level: 'gm' }],
    })
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    expect(await screen.findByText(/access.grants.deletedScope/)).toBeInTheDocument()
  })

  it('says so when there are no grants yet', async () => {
    mockApi()
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    expect(await screen.findByText('access.grants.empty')).toBeInTheDocument()
  })

  it('only offers restricted systems as grant targets', async () => {
    mockApi({
      systems: [
        { id: 's1', name: 'Restricted', access_level: 'admin' },
        { id: 's2', name: 'Open shelf', access_level: '' },
      ],
    })
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    // Granting access to something nobody is restricted from is meaningless.
    expect(await screen.findByRole('option', { name: 'Restricted' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Open shelf' })).toBeNull()
  })

  it('creates a grant with the chosen scope and level', async () => {
    mockApi({ systems: [{ id: 's1', name: 'Ravenloft', access_level: 'admin' }] })
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    const picker = await screen.findByLabelText('access.grants.addSystem')
    fireEvent.change(picker, { target: { value: 's1' } })
    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0])
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/u1/access-grants', {
        scope_type: 'system',
        scope_id: 's1',
        level: 'gm',
      })
    )
  })

  it('revokes a grant', async () => {
    mockApi({
      grants: [{ id: 'g1', scope_type: 'system', scope_id: 's1', scope_name: 'D&D', level: 'gm' }],
    })
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    fireEvent.click(await screen.findByLabelText('access.grants.remove'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/u1/access-grants/g1'))
  })

  it('surfaces a failure to create a grant', async () => {
    mockApi({ systems: [{ id: 's1', name: 'Ravenloft', access_level: 'admin' }] })
    api.post.mockRejectedValue(new Error('denied'))
    render(<UserAccessGrantsSection userId="u1" userRole="gm" />)
    const picker = await screen.findByLabelText('access.grants.addSystem')
    fireEvent.change(picker, { target: { value: 's1' } })
    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0])
    expect(await screen.findByText('denied')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SimpleLookupManager from './SimpleLookupManager'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}))
vi.mock('../Spinner', () => ({ default: () => <div>spinner</div> }))
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

const items = [{ id: 'p1', name: 'Dungeons & Dragons', is_default: false, sort_order: 0 }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockResolvedValue({ parent_systems: items })
  vi.mocked(api.post).mockResolvedValue({ id: 'p2', name: 'Cyberpunk' })
  vi.mocked(api.delete).mockResolvedValue({ status: 'ok' })
})

const renderManager = () =>
  render(
    <SimpleLookupManager
      endpoint="/parent-systems"
      listKey="parent_systems"
      addPlaceholder="Parent system name"
    />
  )

describe('SimpleLookupManager', () => {
  it('loads and lists items from the endpoint', async () => {
    renderManager()
    expect(await screen.findByText('Dungeons & Dragons')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/parent-systems')
  })

  it('shows an empty message when the list is empty', async () => {
    vi.mocked(api.get).mockResolvedValue({ parent_systems: [] })
    renderManager()
    expect(await screen.findByText('lookupSettings.empty')).toBeInTheDocument()
  })

  it('creates an item via the add button', async () => {
    renderManager()
    await screen.findByText('Dungeons & Dragons')
    await userEvent.type(screen.getByLabelText('Parent system name'), 'Cyberpunk')
    await userEvent.click(screen.getByText('lookupSettings.add'))
    expect(api.post).toHaveBeenCalledWith('/parent-systems', { name: 'Cyberpunk' })
  })

  it('confirms before force-deleting an in-use item', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        status: 409,
        body: { detail: { name: 'Dungeons & Dragons', usage_count: 3 } },
      })
    )
    renderManager()
    await screen.findByText('Dungeons & Dragons')
    await userEvent.click(screen.getByLabelText('common.remove Dungeons & Dragons'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    vi.mocked(api.delete).mockResolvedValueOnce({ status: 'ok' })
    await userEvent.click(screen.getByText('lookupSettings.confirmRemove'))
    await waitFor(() =>
      expect(api.delete).toHaveBeenLastCalledWith('/parent-systems/p1?force=true')
    )
  })
})

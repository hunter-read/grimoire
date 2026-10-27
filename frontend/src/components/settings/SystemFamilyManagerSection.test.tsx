import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemFamilyManagerSection from './SystemFamilyManagerSection'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}))
vi.mock('../Spinner', () => ({ default: () => <div>spinner</div> }))
vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const families = [{ id: 'f1', name: 'Fate', is_default: true, sort_order: 0 }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockResolvedValue({ families })
  vi.mocked(api.post).mockResolvedValue({ id: 'f2', name: 'GURPS' })
  vi.mocked(api.delete).mockResolvedValue({ status: 'ok' })
})

describe('SystemFamilyManagerSection', () => {
  it('lists families', async () => {
    render(<SystemFamilyManagerSection />)
    expect(await screen.findByText('Fate')).toBeInTheDocument()
  })

  it('creates a family', async () => {
    render(<SystemFamilyManagerSection />)
    await screen.findByText('Fate')
    await userEvent.type(screen.getByLabelText('lookupSettings.namePlaceholder'), 'GURPS')
    await userEvent.click(screen.getByText('lookupSettings.add'))
    expect(api.post).toHaveBeenCalledWith('/system-families', { name: 'GURPS' })
  })

  it('confirms before force-deleting an in-use family', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        status: 409,
        body: { detail: { name: 'Fate', usage_count: 2 } },
      })
    )
    render(<SystemFamilyManagerSection />)
    await screen.findByText('Fate')
    await userEvent.click(screen.getByLabelText('common.remove Fate'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    vi.mocked(api.delete).mockResolvedValueOnce({ status: 'ok' })
    await userEvent.click(screen.getByText('lookupSettings.confirmRemove'))
    await waitFor(() =>
      expect(api.delete).toHaveBeenLastCalledWith('/system-families/f1?force=true')
    )
  })
})

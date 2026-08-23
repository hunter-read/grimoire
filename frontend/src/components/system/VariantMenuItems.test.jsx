import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o?.defaultValue ? o.defaultValue : k) }),
}))

const get = vi.fn()
vi.mock('../../api', () => ({ default: { get: (...a) => get(...a) } }))

import VariantMenuItems from './VariantMenuItems'

const renderItems = ({ onPick = vi.fn(), book = { id: 'b1', variant_count: 1 } } = {}) =>
  render(
    <MemoryRouter>
      <VariantMenuItems book={book} itemStyle={{}} onPick={onPick} />
    </MemoryRouter>
  )

describe('VariantMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    get.mockResolvedValue({
      id: 'b1',
      variant_main_id: 'b1',
      variants: [{ id: 'b2', kind: 'printer-friendly', label: '' }],
    })
  })

  it('does not fetch the family until the section is opened', () => {
    renderItems()
    expect(get).not.toHaveBeenCalled()
  })

  it('loads and lists the versions on expand', async () => {
    renderItems()
    await userEvent.click(screen.getByRole('menuitem', { name: /switchLabel/ }))
    await waitFor(() => expect(get).toHaveBeenCalledWith('/books/b1'))
    expect(await screen.findByRole('menuitemradio', { name: /mainVersion/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /printer-friendly/ })).toBeInTheDocument()
  })

  it('fetches only once even if toggled repeatedly', async () => {
    renderItems()
    const trigger = screen.getByRole('menuitem', { name: /switchLabel/ })
    await userEvent.click(trigger)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await userEvent.click(trigger)
    await userEvent.click(trigger)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('marks the version currently being viewed', async () => {
    renderItems()
    await userEvent.click(screen.getByRole('menuitem', { name: /switchLabel/ }))
    const current = await screen.findByRole('menuitemradio', { name: /mainVersion/ })
    expect(current).toHaveAttribute('aria-checked', 'true')
  })

  it('hands the chosen id back to the caller', async () => {
    const onPick = vi.fn()
    renderItems({ onPick })
    await userEvent.click(screen.getByRole('menuitem', { name: /switchLabel/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /printer-friendly/ }))
    expect(onPick).toHaveBeenCalledWith('b2')
  })

  it('survives a failed lookup', async () => {
    get.mockRejectedValue(new Error('offline'))
    renderItems()
    await userEvent.click(screen.getByRole('menuitem', { name: /switchLabel/ }))
    await waitFor(() => expect(get).toHaveBeenCalled())
    // No crash, and no stale spinner left behind.
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
  })
})

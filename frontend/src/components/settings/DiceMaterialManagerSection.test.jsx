import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiceMaterialManagerSection from './DiceMaterialManagerSection'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (o?.defaultValue ? o.defaultValue : o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}))
vi.mock('../Spinner', () => ({ default: () => <div>spinner</div> }))
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

const items = [
  { id: 'd1', name: 'D20', group: 'Dice', is_default: true },
  { id: 'c1', name: 'Tarot Cards', group: 'Cards', is_default: true },
  { id: 'x1', name: 'Spinner', group: 'Custom', is_default: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ dice_materials: items })
  api.post.mockResolvedValue({ id: 'n1', name: 'Fudge Dice', group: 'Dice' })
  api.delete.mockResolvedValue({ status: 'ok' })
})

describe('DiceMaterialManagerSection', () => {
  it('lists items grouped by their group', async () => {
    render(<DiceMaterialManagerSection />)
    expect(await screen.findByText('D20')).toBeInTheDocument()
    expect(screen.getByText('Tarot Cards')).toBeInTheDocument()
    expect(screen.getByText('Spinner')).toBeInTheDocument()
    // "Dice" appears both as a group heading and a select option (>1 match).
    expect(screen.getAllByText('Dice').length).toBeGreaterThan(1)
  })

  it('creates an item with the selected group', async () => {
    render(<DiceMaterialManagerSection />)
    await screen.findByText('D20')
    await userEvent.type(screen.getByLabelText('lookupSettings.diceNamePlaceholder'), 'Fudge Dice')
    await userEvent.selectOptions(screen.getByLabelText('lookupSettings.diceGroupLabel'), 'Dice')
    await userEvent.click(screen.getByText('lookupSettings.add'))
    expect(api.post).toHaveBeenCalledWith('/dice-materials', { name: 'Fudge Dice', group: 'Dice' })
  })

  it('removes an item', async () => {
    render(<DiceMaterialManagerSection />)
    await screen.findByText('Spinner')
    await userEvent.click(screen.getByLabelText('common.remove Spinner'))
    expect(api.delete).toHaveBeenCalledWith('/dice-materials/x1')
  })
})

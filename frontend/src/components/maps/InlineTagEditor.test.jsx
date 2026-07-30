import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InlineTagEditor from './InlineTagEditor'

// InlineTagEditor now wraps the shared TagPicker, which loads the tag catalog.
const mockList = vi.fn()
vi.mock('../../api', () => ({
  tags: { list: (...a) => mockList(...a) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({ tags: [] })
})

describe('InlineTagEditor', () => {
  it('renders existing tags as chips', () => {
    render(<InlineTagEditor tags={['forest', 'cave']} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('forest')).toBeInTheDocument()
    expect(screen.getByText('cave')).toBeInTheDocument()
  })

  it('saves the updated list when a tag is added', async () => {
    const onSave = vi.fn()
    render(<InlineTagEditor tags={[]} onSave={onSave} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByRole('combobox'), 'dungeon{Enter}')
    expect(onSave).toHaveBeenCalledWith(['dungeon'])
  })

  it('saves when a tag is removed via its chip', async () => {
    const onSave = vi.fn()
    render(<InlineTagEditor tags={['keep', 'drop']} onSave={onSave} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByLabelText(/remove drop/i))
    expect(onSave).toHaveBeenCalledWith(['keep'])
  })

  it('calls onCancel from the Done button', async () => {
    const onCancel = vi.fn()
    render(<InlineTagEditor tags={[]} onSave={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByText(/done/i))
    expect(onCancel).toHaveBeenCalled()
  })
})

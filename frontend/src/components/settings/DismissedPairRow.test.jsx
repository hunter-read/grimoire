import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DismissedPairRow from './DismissedPairRow'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const dismissal = (extra = {}) => ({
  id: 'd1',
  resource_type: 'book',
  member_ids: ['a', 'b'],
  member_names: ['core.pdf', 'core (1).pdf'],
  note: '',
  created_at: '2026-01-01T00:00:00',
  ...extra,
})

describe('DismissedPairRow', () => {
  it('names every member of the dismissed set', () => {
    render(<DismissedPairRow dismissal={dismissal()} onRestore={vi.fn()} />)
    expect(screen.getByText('core.pdf')).toBeInTheDocument()
    expect(screen.getByText('core (1).pdf')).toBeInTheDocument()
  })

  it('shows which collection the dismissal belongs to', () => {
    render(<DismissedPairRow dismissal={dismissal()} onRestore={vi.fn()} />)
    expect(screen.getByText('book')).toBeInTheDocument()
  })

  it('falls back to the id when a member no longer has a name', () => {
    // The file was deleted after the dismissal was made, so the server has no
    // name to return. Dropping the entry would understate the set.
    const d = dismissal({ member_names: ['core.pdf'] })
    render(<DismissedPairRow dismissal={d} onRestore={vi.fn()} />)
    expect(screen.getByText('core.pdf')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('shows a note when one was recorded', () => {
    render(
      <DismissedPairRow dismissal={dismissal({ note: 'different printing' })} onRestore={vi.fn()} />
    )
    expect(screen.getByText('different printing')).toBeInTheDocument()
  })

  it('hands the dismissal back when restore is clicked', async () => {
    const onRestore = vi.fn()
    render(<DismissedPairRow dismissal={dismissal()} onRestore={onRestore} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onRestore).toHaveBeenCalledWith(dismissal())
  })

  it('cannot be clicked twice while the restore is in flight', async () => {
    const onRestore = vi.fn()
    render(<DismissedPairRow dismissal={dismissal()} onRestore={onRestore} busy />)
    expect(screen.getByRole('button')).toBeDisabled()
    await userEvent.click(screen.getByRole('button'))
    expect(onRestore).not.toHaveBeenCalled()
  })
})

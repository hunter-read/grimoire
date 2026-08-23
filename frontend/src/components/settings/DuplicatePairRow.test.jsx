import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DuplicatePairRow from './DuplicatePairRow'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const pair = (extra = {}) => ({
  pairKey: 'g1:a:b',
  groupId: 'g1',
  resourceType: 'book',
  reasonText: 'identical files',
  confidence: 0.92,
  parent: { id: 'a', filename: 'a.pdf', title: 'Core Rules', file_size: 1048576 },
  child: { id: 'b', filename: 'b.pdf', title: 'Core Rules (1)', file_size: 1048576 },
  ...extra,
})

describe('DuplicatePairRow', () => {
  it('shows both copies with why they were flagged', () => {
    render(<DuplicatePairRow pair={pair()} onCompare={vi.fn()} />)
    expect(screen.getByText(/Core Rules$/)).toBeInTheDocument()
    expect(screen.getByText(/Core Rules \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('identical files')).toBeInTheDocument()
  })

  it('rounds the confidence to a percentage', () => {
    render(<DuplicatePairRow pair={pair()} onCompare={vi.fn()} />)
    expect(screen.getByText(/92%/)).toBeInTheDocument()
  })

  it('falls back to the filename when there is no title', () => {
    const p = pair()
    p.parent.title = null
    render(<DuplicatePairRow pair={p} onCompare={vi.fn()} />)
    expect(screen.getByText(/a\.pdf/)).toBeInTheDocument()
  })

  it('hands the whole pair to the compare handler', async () => {
    const onCompare = vi.fn()
    const p = pair()
    render(<DuplicatePairRow pair={p} onCompare={onCompare} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onCompare).toHaveBeenCalledWith(p)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareAccessTable from './ShareAccessTable'

const members = [
  { user_id: 'u2', username: 'alice' },
  { user_id: 'u3', character_name: 'Bob the Bold', username: 'bob' },
]

const setup = (over = {}) => {
  const onChange = vi.fn()
  render(
    <ShareAccessTable members={members} readIds={[]} writeIds={[]} onChange={onChange} {...over} />
  )
  return { onChange }
}

describe('ShareAccessTable', () => {
  it('renders a Name / Read / Write header and one row per member', () => {
    setup()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Name', 'Can read', 'Can edit'])
    // Header row plus one per member.
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('alice')).toBeInTheDocument()
    // A member with a character name is listed by that name.
    expect(screen.getByText('Bob the Bold')).toBeInTheDocument()
  })

  it('grants read on its own', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('checkbox', { name: 'Read access for alice' }))
    expect(onChange).toHaveBeenCalledWith(['u2'], [])
  })

  // Write implies read, so the pair emitted is always valid.
  it('grants read alongside write when write is ticked', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('checkbox', { name: 'Write access for alice' }))
    expect(onChange).toHaveBeenCalledWith(['u2'], ['u2'])
  })

  // The implication is shown in the control rather than left as a rule to know.
  it('auto-checks and disables read for a writer', () => {
    setup({ readIds: ['u2'], writeIds: ['u2'] })
    const read = screen.getByRole('checkbox', { name: 'Read access for alice' })
    expect(read).toBeChecked()
    expect(read).toBeDisabled()
  })

  // Even if the caller passes an inconsistent pair (write without read), the
  // row still renders read as checked — write is the stronger claim.
  it('shows read as checked for a writer missing from the read list', () => {
    setup({ readIds: [], writeIds: ['u2'] })
    expect(screen.getByRole('checkbox', { name: 'Read access for alice' })).toBeChecked()
  })

  it('leaves other members’ rows alone', () => {
    setup({ readIds: ['u2'], writeIds: ['u2'] })
    expect(screen.getByRole('checkbox', { name: 'Read access for Bob the Bold' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Read access for Bob the Bold' })).not.toBeChecked()
  })

  it('downgrades a writer to reader when write is unticked', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ readIds: ['u2'], writeIds: ['u2'] })
    await user.click(screen.getByRole('checkbox', { name: 'Write access for alice' }))
    // Read survives — unticking write is a downgrade, not a revoke.
    expect(onChange).toHaveBeenCalledWith(['u2'], [])
  })

  it('revokes access entirely when read is unticked', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ readIds: ['u2', 'u3'], writeIds: [] })
    await user.click(screen.getByRole('checkbox', { name: 'Read access for alice' }))
    expect(onChange).toHaveBeenCalledWith(['u3'], [])
  })

  it('preserves the other members when one row changes', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ readIds: ['u3'], writeIds: ['u3'] })
    await user.click(screen.getByRole('checkbox', { name: 'Read access for alice' }))
    const [reads, writes] = onChange.mock.calls[0]
    expect(new Set(reads)).toEqual(new Set(['u2', 'u3']))
    expect(writes).toEqual(['u3'])
  })

  it('right-aligns the two checkbox columns', () => {
    setup()
    const [, readHeader, writeHeader] = screen.getAllByRole('columnheader')
    expect(readHeader.style.textAlign).toBe('right')
    expect(writeHeader.style.textAlign).toBe('right')
  })

  it('shows an empty state when there is nobody to share with', () => {
    setup({ members: [] })
    expect(screen.getByText('No members to share with.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps each row’s boxes with the right member', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    const rows = screen.getAllByRole('row').slice(1) // drop the header
    await user.click(within(rows[1]).getByRole('checkbox', { name: /Write access/ }))
    expect(onChange).toHaveBeenCalledWith(['u3'], ['u3'])
  })
})

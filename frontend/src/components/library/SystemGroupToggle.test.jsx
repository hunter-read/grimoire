import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemGroupToggle from './SystemGroupToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => (k === 'library.groupContainers' ? 'Group collections' : k),
  }),
}))

describe('SystemGroupToggle', () => {
  it('renders a switch checked when grouping is on', () => {
    render(<SystemGroupToggle grouped onToggle={() => {}} />)
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('Group collections')).toBeInTheDocument()
  })

  it('is unchecked when containers are flattened', () => {
    render(<SystemGroupToggle grouped={false} onToggle={() => {}} />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('fires onToggle with the new value when clicked', async () => {
    const onToggle = vi.fn()
    render(<SystemGroupToggle grouped onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('toggles back on from the flattened state', async () => {
    const onToggle = vi.fn()
    render(<SystemGroupToggle grouped={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})

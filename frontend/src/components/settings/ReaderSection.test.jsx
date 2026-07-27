import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderSection from './ReaderSection'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../../hooks/useUserPrefs', () => ({
  getUserPrefs: vi.fn(() => ({})),
  saveUserPref: vi.fn(),
}))
// SegmentedControl renders a button per option; keep it real but simple.
vi.mock('./SegmentedControl', () => ({
  default: ({ options, onChange }) => (
    <div>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  getUserPrefs.mockReturnValue({})
})

describe('ReaderSection', () => {
  it('saves the reader mode when an option is picked', async () => {
    render(<ReaderSection />)
    await userEvent.click(screen.getByText('userSettings.reader.spread'))
    expect(saveUserPref).toHaveBeenCalledWith('readerMode', 'spread')
  })

  it('toggles the wheel-nav switch and persists it', async () => {
    render(<ReaderSection />)
    const sw = screen.getByRole('switch')
    // Defaults to on (wheelNav !== false).
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(sw)
    expect(saveUserPref).toHaveBeenCalledWith('wheelNav', false)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('reflects a stored wheelNav=false preference', () => {
    getUserPrefs.mockReturnValue({ wheelNav: false })
    render(<ReaderSection />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})

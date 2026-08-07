import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderSection from './ReaderSection'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../../hooks/useUserPrefs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // getWheelAction stays real — its back-compat behaviour is under test.
    getUserPrefs: vi.fn(() => ({})),
    saveUserPref: vi.fn(),
  }
})
// SegmentedControl renders a button per option; keep it real but simple. The
// selected value is exposed so tests can assert what the control reads back.
vi.mock('./SegmentedControl', () => ({
  default: ({ options, value, onChange }) => (
    // Keyed by the first option so each control on the page is addressable —
    // the section renders one for reader mode and one for the wheel action.
    <div>
      <span data-testid={`segmented-value-${options[0].value}`}>{value}</span>
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

  it('offers all three wheel actions and persists the chosen one', async () => {
    render(<ReaderSection />)
    expect(screen.getByText('userSettings.reader.wheelPage')).toBeInTheDocument()
    expect(screen.getByText('userSettings.reader.wheelNone')).toBeInTheDocument()

    await userEvent.click(screen.getByText('userSettings.reader.wheelZoom'))
    expect(saveUserPref).toHaveBeenCalledWith('wheelAction', 'zoom')
  })

  it('reads back a stored wheelAction', () => {
    getUserPrefs.mockReturnValue({ wheelAction: 'zoom' })
    render(<ReaderSection />)
    expect(screen.getByTestId('segmented-value-page')).toHaveTextContent('zoom')
  })

  it('reads a legacy wheelNav=false as "none"', () => {
    // The pref used to be a boolean; "off" meant don't page on scroll, which
    // is now the 'none' action rather than a missing preference.
    getUserPrefs.mockReturnValue({ wheelNav: false })
    render(<ReaderSection />)
    expect(screen.getByTestId('segmented-value-page')).toHaveTextContent('none')
  })

  it('reads a legacy wheelNav=true as the paging default', () => {
    getUserPrefs.mockReturnValue({ wheelNav: true })
    render(<ReaderSection />)
    expect(screen.getByTestId('segmented-value-page')).toHaveTextContent('page')
  })
})

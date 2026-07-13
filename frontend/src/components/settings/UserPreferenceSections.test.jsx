import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageSection, LibrarySection } from './UserPreferenceSections'
import { getUserPrefs } from '../../hooks/useUserPrefs'
import { RECENT_DEFAULT, RECENT_MAX } from '../../hooks/useBookPrefs'
import i18n from '../../i18n'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../i18n', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: { ...actual.default, changeLanguage: vi.fn() },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// LanguageSection — rendering
// ---------------------------------------------------------------------------

describe('LanguageSection — rendering', () => {
  it('renders the section heading', () => {
    render(<LanguageSection />)
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })

  it('renders a <select> element', () => {
    render(<LanguageSection />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders at least the English option', () => {
    render(<LanguageSection />)
    expect(screen.getAllByRole('option', { name: /english/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('defaults to en-US when localStorage has no saved language', () => {
    render(<LanguageSection />)
    const select = screen.getByRole('combobox')
    expect(select.value).toBe('en-US')
  })

  it('defaults to the saved language from localStorage', () => {
    localStorage.setItem('grimoire:language', 'de-DE')
    render(<LanguageSection />)
    const select = screen.getByRole('combobox')
    expect(select.value).toBe('de-DE')
  })
})

// ---------------------------------------------------------------------------
// LanguageSection — language change
// ---------------------------------------------------------------------------

describe('LanguageSection — language change', () => {
  it('updates the select value when a new language is chosen', () => {
    render(<LanguageSection />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'fr-CA' } })
    expect(select.value).toBe('fr-CA')
  })

  it('saves the chosen language to localStorage', () => {
    render(<LanguageSection />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'de-DE' } })
    expect(localStorage.getItem('grimoire:language')).toBe('de-DE')
  })

  it('calls i18n.changeLanguage with the selected locale', () => {
    render(<LanguageSection />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr-CA' } })
    expect(i18n.changeLanguage).toHaveBeenCalledWith('fr-CA')
  })

  it('shows the saved indicator after a change', () => {
    render(<LanguageSection />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr-CA' } })
    // The LuCircleCheck is rendered as an svg icon; the save flash is visible
    expect(document.querySelector('svg')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// LibrarySection — recently opened limit
// ---------------------------------------------------------------------------

describe('LibrarySection — recently opened limit', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to RECENT_DEFAULT when unset', () => {
    render(<LibrarySection />)
    expect(screen.getByRole('spinbutton').value).toBe(String(RECENT_DEFAULT))
  })

  it('reflects the saved limit', () => {
    localStorage.setItem('grimoire:user-prefs', JSON.stringify({ recentLimit: 12 }))
    render(<LibrarySection />)
    expect(screen.getByRole('spinbutton').value).toBe('12')
  })

  it('saves a changed limit to user prefs', () => {
    render(<LibrarySection />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })
    expect(getUserPrefs().recentLimit).toBe(8)
  })

  it('clamps values above the maximum', () => {
    render(<LibrarySection />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '999' } })
    expect(getUserPrefs().recentLimit).toBe(RECENT_MAX)
  })

  it('accepts 0 to disable the feature', () => {
    render(<LibrarySection />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
    expect(getUserPrefs().recentLimit).toBe(0)
  })

  it('reverts an empty value to the default on blur', () => {
    render(<LibrarySection />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe(String(RECENT_DEFAULT))
    expect(getUserPrefs().recentLimit).toBe(RECENT_DEFAULT)
  })
})

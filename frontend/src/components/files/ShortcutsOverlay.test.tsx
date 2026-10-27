import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShortcutsOverlay from './ShortcutsOverlay'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

beforeEach(() => vi.clearAllMocks())

describe('ShortcutsOverlay', () => {
  it('lists the bindings under their groups', () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    expect(screen.getByText('files.shortcutGroupMove')).toBeInTheDocument()
    expect(screen.getByText('files.shortcutPreview')).toBeInTheDocument()
    expect(screen.getByText('files.shortcutSelectAll')).toBeInTheDocument()
    expect(screen.getByText('Space')).toBeInTheDocument()
  })

  it('names the modifier for the platform', () => {
    // A macOS user reads "Ctrl" as a different key, not as a synonym, so the
    // wrong one makes the whole table look wrong.
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    // RTL normalises the runs of whitespace the table uses for spacing.
    expect(screen.getByText('⌘ A')).toBeInTheDocument()
  })

  it('names Ctrl off a Mac', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    expect(screen.getByText('Ctrl A')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    // Handled here rather than in the pane: this carries role="dialog", which
    // the pane reads as "these keys are not mine".
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a backdrop click but not on a click inside', async () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('common.close'))
    expect(onClose).toHaveBeenCalled()
  })
})

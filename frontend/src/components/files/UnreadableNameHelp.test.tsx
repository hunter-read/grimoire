import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UnreadableNameHelp from './UnreadableNameHelp'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const open = () => fireEvent.click(screen.getByTestId('unreadable-name-help'))

describe('UnreadableNameHelp', () => {
  it('explains itself on hover through its title', () => {
    render(<UnreadableNameHelp />)
    const button = screen.getByTestId('unreadable-name-help')
    expect(button).toHaveAttribute('title', 'files.unreadableName')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('opens the note on click and closes it on a second click', () => {
    render(<UnreadableNameHelp />)
    open()
    expect(screen.getByRole('note')).toHaveTextContent('files.unreadableName')
    expect(screen.getByTestId('unreadable-name-help')).toHaveAttribute('aria-expanded', 'true')
    open()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('does not let the click reach the row behind it', () => {
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <UnreadableNameHelp />
      </div>
    )
    open()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['a click elsewhere', () => fireEvent.pointerDown(document.body)],
    ['a scroll', () => fireEvent.scroll(window)],
  ])('closes on %s', (_, dismiss) => {
    render(<UnreadableNameHelp />)
    open()
    dismiss()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('stays open for other keys', () => {
    render(<UnreadableNameHelp />)
    open()
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})

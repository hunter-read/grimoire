import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ReaderSidebarShell from './ReaderSidebarShell'

const isMobile = vi.fn()
vi.mock('../../hooks/useIsMobile', () => ({ default: () => isMobile() }))

beforeEach(() => {
  isMobile.mockReset()
})

describe('ReaderSidebarShell', () => {
  it('is a fixed-width column beside the page on a desktop', () => {
    isMobile.mockReturnValue(false)
    render(<ReaderSidebarShell>body</ReaderSidebarShell>)

    const shell = screen.getByTestId('reader-sidebar')
    expect(shell).toHaveStyle({ width: '280px', flex: '0 0 280px' })
    expect(shell.style.borderLeft).toBe('1px solid var(--border)')
  })

  it('honours a wider width, as the details panel asks for', () => {
    isMobile.mockReturnValue(false)
    render(<ReaderSidebarShell width={320}>body</ReaderSidebarShell>)

    expect(screen.getByTestId('reader-sidebar')).toHaveStyle({ width: '320px' })
  })

  // On a phone a 280px column leaves neither the panel nor the page usable, so
  // the panel takes the viewport instead.
  it('fills the viewport on a phone', () => {
    isMobile.mockReturnValue(true)
    render(<ReaderSidebarShell>body</ReaderSidebarShell>)

    const shell = screen.getByTestId('reader-sidebar')
    expect(shell).toHaveStyle({ width: '100%', flex: '1 1 100%' })
  })

  it('drops the dividing border on a phone, where nothing sits beside it', () => {
    isMobile.mockReturnValue(true)
    render(<ReaderSidebarShell>body</ReaderSidebarShell>)

    // jsdom serializes the `none` shorthand back as the width longhand
    // ("medium"), so the style longhand is what actually pins this down.
    expect(screen.getByTestId('reader-sidebar').style.borderLeftStyle).not.toBe('solid')
  })

  it('clips its contents only when asked, as the search panel does', () => {
    isMobile.mockReturnValue(false)
    const { rerender } = render(<ReaderSidebarShell>body</ReaderSidebarShell>)
    expect(screen.getByTestId('reader-sidebar')).not.toHaveStyle({ overflow: 'hidden' })

    rerender(<ReaderSidebarShell overflowHidden>body</ReaderSidebarShell>)
    expect(screen.getByTestId('reader-sidebar')).toHaveStyle({ overflow: 'hidden' })
  })

  it('renders its children', () => {
    isMobile.mockReturnValue(false)
    render(
      <ReaderSidebarShell>
        <span>panel contents</span>
      </ReaderSidebarShell>
    )
    expect(screen.getByText('panel contents')).toBeInTheDocument()
  })

  // The export panel's cut-out tab draws on the page, so on a phone it docks
  // under the page instead of replacing it.
  it('docks under the page as a sheet on a phone when asked', () => {
    isMobile.mockReturnValue(true)
    render(<ReaderSidebarShell sheet>body</ReaderSidebarShell>)

    const shell = screen.getByTestId('reader-sidebar')
    expect(shell).toHaveStyle({ width: '100%', maxHeight: '48%' })
    expect(shell.style.borderTop).toBe('1px solid var(--border)')
  })

  it('ignores the sheet request on a desktop', () => {
    isMobile.mockReturnValue(false)
    render(<ReaderSidebarShell sheet>body</ReaderSidebarShell>)
    expect(screen.getByTestId('reader-sidebar')).toHaveStyle({ width: '280px' })
  })

  describe('as a landmark', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open contents</button>
          {open && (
            <ReaderSidebarShell label="Contents">
              <button onClick={() => setOpen(false)}>Close</button>
            </ReaderSidebarShell>
          )}
        </>
      )
    }

    it('is a named complementary region', () => {
      isMobile.mockReturnValue(false)
      render(<ReaderSidebarShell label="Contents">body</ReaderSidebarShell>)
      expect(screen.getByRole('complementary', { name: 'Contents' })).toBeInTheDocument()
    })

    it('takes focus when it opens and gives it back when it closes', () => {
      isMobile.mockReturnValue(false)
      render(<Harness />)
      const opener = screen.getByText('Open contents')
      opener.focus()
      fireEvent.click(opener)
      expect(screen.getByRole('complementary', { name: 'Contents' })).toHaveFocus()
      const close = screen.getByText('Close')
      close.focus()
      fireEvent.click(close)
      expect(opener).toHaveFocus()
    })

    it('leaves focus on a field inside that took it first', () => {
      isMobile.mockReturnValue(false)
      render(
        <ReaderSidebarShell label="Search">
          <input aria-label="Query" autoFocus />
        </ReaderSidebarShell>
      )
      expect(screen.getByLabelText('Query')).toHaveFocus()
    })

    it('is a landmark as a phone sheet too', () => {
      isMobile.mockReturnValue(true)
      render(
        <ReaderSidebarShell sheet label="Export">
          body
        </ReaderSidebarShell>
      )
      expect(screen.getByRole('complementary', { name: 'Export' })).toBeInTheDocument()
    })
  })
})

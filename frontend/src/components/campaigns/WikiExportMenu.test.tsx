import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WikiExportMenu from './WikiExportMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) =>
      ({
        'wiki.export': 'Export',
        'wiki.exportTitle': 'Export the wiki',
        'wiki.exportMd': 'Markdown folder (.zip)',
        'wiki.exportMdHint': 'One file per page',
        'wiki.exportMdFile': 'Single Markdown file',
        'wiki.exportMdFileHint': 'Every page in one document',
        'wiki.exportJson': 'JSON bundle',
        'wiki.exportJsonHint': 'The full wiki as Grimoire JSON',
      })[k] || k,
  }),
}))

const open = () => fireEvent.click(screen.getByRole('button', { name: /export/i }))

describe('WikiExportMenu', () => {
  let onExport

  beforeEach(() => {
    onExport = vi.fn()
  })

  it('keeps the menu closed until the trigger is clicked', () => {
    render(<WikiExportMenu onExport={onExport} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('offers every export format behind the one button', () => {
    render(<WikiExportMenu onExport={onExport} />)
    open()
    expect(screen.getByRole('menuitem', { name: /markdown folder/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /single markdown file/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /json bundle/i })).toBeInTheDocument()
  })

  it.each([
    [/markdown folder/i, 'md'],
    [/single markdown file/i, 'mdfile'],
    [/json bundle/i, 'json'],
  ])('exports %s as format %s', (name, format) => {
    render(<WikiExportMenu onExport={onExport} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(onExport).toHaveBeenCalledWith(format)
  })

  it('closes the menu after a format is chosen', () => {
    render(<WikiExportMenu onExport={onExport} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /json bundle/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and on a click outside', () => {
    render(<WikiExportMenu onExport={onExport} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onExport).not.toHaveBeenCalled()
  })

  it('toggles closed when the trigger is clicked again', () => {
    render(<WikiExportMenu onExport={onExport} />)
    open()
    open()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reports its open state to assistive tech', () => {
    render(<WikiExportMenu onExport={onExport} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    open()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  // The button lives at the foot of the sidebar, so a menu that only ever opened
  // downward would fall off the bottom of a short window.
  it('opens upward when there is no room below the trigger', () => {
    render(<WikiExportMenu onExport={onExport} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 730,
      left: 20,
      right: 200,
      width: 180,
      height: 30,
    })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(760)
    open()
    expect(screen.getByRole('menu')).toHaveStyle({ top: '496px' })
  })

  it('keeps the menu on screen when the trigger is near the right edge', () => {
    render(<WikiExportMenu onExport={onExport} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 40,
      left: 900,
      right: 980,
      width: 80,
      height: 30,
    })
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    open()
    // 1000 - 8 margin - 260 menu width
    expect(screen.getByRole('menu')).toHaveStyle({ left: '732px' })
  })

  it('repositions when the page scrolls under an open menu', () => {
    render(<WikiExportMenu onExport={onExport} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    open()
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 130,
      left: 30,
      right: 210,
      width: 180,
      height: 30,
    })
    fireEvent.scroll(document, {})
    expect(screen.getByRole('menu')).toHaveStyle({ top: '134px' })
  })
})

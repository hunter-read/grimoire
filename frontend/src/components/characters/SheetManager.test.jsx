import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetManager from './SheetManager'

// The two panels are covered by their own tests; here they are stubbed so the
// assertions are about the shell - which tab shows, and what closes what.
vi.mock('./SheetsTab', () => ({
  default: ({ onBrowse }) => (
    <div>
      <span>sheets panel</span>
      <button onClick={onBrowse}>open catalogue</button>
    </div>
  ),
}))
vi.mock('./RulesetsPanel', () => ({ default: () => <div>rulesets panel</div> }))
vi.mock('./SheetCatalogue', () => ({
  default: ({ onClose }) => (
    <div role="dialog" aria-label="Browse sheets">
      <button onClick={onClose}>close catalogue</button>
    </div>
  ),
}))

const renderManager = (props = {}) =>
  render(<SheetManager schemas={[]} onChanged={vi.fn()} onClose={vi.fn()} {...props} />)

beforeEach(() => vi.clearAllMocks())

describe('SheetManager', () => {
  it('opens on the sheets tab', () => {
    renderManager()
    expect(screen.getByText('sheets panel')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sheets' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to content', async () => {
    renderManager()
    await userEvent.click(screen.getByRole('tab', { name: 'Content' }))
    expect(screen.getByText('rulesets panel')).toBeInTheDocument()
    expect(screen.queryByText('sheets panel')).not.toBeInTheDocument()
  })

  it('can open straight onto content from the old rulesets link', () => {
    // Where the old /characters/rulesets route now lands, so a bookmark still
    // arrives at the thing it named.
    renderManager({ initialTab: 'rulesets' })
    expect(screen.getByText('rulesets panel')).toBeInTheDocument()
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    renderManager({ onClose })
    await userEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    renderManager({ onClose })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the scrim behind it is clicked', async () => {
    const onClose = vi.fn()
    renderManager({ onClose })
    // The dialog is the panel; the scrim is what surrounds it.
    await userEvent.click(screen.getByRole('dialog', { name: 'Manage sheets' }).parentElement)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a click inside the panel', async () => {
    const onClose = vi.fn()
    renderManager({ onClose })
    await userEvent.click(screen.getByText('sheets panel'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus into the dialog when it opens', () => {
    renderManager()
    expect(screen.getByRole('dialog', { name: 'Manage sheets' })).toContainElement(
      document.activeElement
    )
  })

  it('moves between tabs with the arrow keys', async () => {
    renderManager()
    screen.getByRole('tab', { name: 'Sheets' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Sheets' })).toHaveAttribute('aria-selected', 'true')
  })

  it('labels its panel with the selected tab', () => {
    renderManager()
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAccessibleName('Sheets')
    expect(screen.getByRole('tab', { name: 'Sheets' })).toHaveAttribute('aria-controls', panel.id)
  })

  it('leaves the manager standing when Escape closes the catalogue over it', async () => {
    // Escape should peel one layer, not both: closing the manager out from
    // under the catalogue loses the tab the user was on.
    const onClose = vi.fn()
    renderManager({ onClose })
    await userEvent.click(screen.getByText('open catalogue'))
    await screen.findByRole('dialog', { name: 'Browse sheets' })

    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refreshes the list when the catalogue closes', async () => {
    // A sheet installed in the catalogue should appear behind it without
    // reopening the manager.
    const onChanged = vi.fn()
    renderManager({ onChanged })
    await userEvent.click(screen.getByText('open catalogue'))
    await userEvent.click(screen.getByText('close catalogue'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'Browse sheets' })).not.toBeInTheDocument()
  })
})

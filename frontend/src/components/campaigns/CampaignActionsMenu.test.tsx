import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CampaignActionsMenu from './CampaignActionsMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) =>
      ({
        'campaignDetail.actionsMenu': 'Campaign actions',
        'campaignDetail.edit': 'Edit',
        'campaignDetail.convertToGroup': 'Convert to group',
        'campaignDetail.archive': 'Archive',
        'campaignDetail.unarchive': 'Unarchive',
        'campaignDetail.convertHint': 'One-way promotion',
      })[k] || k,
  }),
}))

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Campaign actions' }))

const allProps = () => ({
  onEdit: vi.fn(),
  onConvert: vi.fn(),
  onArchive: vi.fn(),
})

describe('CampaignActionsMenu', () => {
  it('renders nothing when the user has no available actions', () => {
    const { container } = render(<CampaignActionsMenu />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the menu closed until the trigger is clicked', () => {
    render(<CampaignActionsMenu {...allProps()} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('shows every action the user is entitled to', () => {
    render(<CampaignActionsMenu {...allProps()} />)
    open()
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Convert to group' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })

  it('omits actions whose handler is not supplied', () => {
    render(<CampaignActionsMenu onEdit={vi.fn()} />)
    open()
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Convert to group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('labels the archive item as Unarchive on an archived campaign', () => {
    render(<CampaignActionsMenu onArchive={vi.fn()} isArchived />)
    open()
    expect(screen.getByRole('menuitem', { name: 'Unarchive' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it.each([
    ['Edit', 'onEdit'],
    ['Convert to group', 'onConvert'],
    ['Archive', 'onArchive'],
  ])('invokes %s and closes the menu', (label, handler) => {
    const props = allProps()
    render(<CampaignActionsMenu {...props} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(props[handler]).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes when clicking outside', () => {
    render(
      <div>
        <CampaignActionsMenu {...allProps()} />
        <button>outside</button>
      </div>
    )
    open()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<CampaignActionsMenu {...allProps()} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('toggles closed when the trigger is clicked again', () => {
    render(<CampaignActionsMenu {...allProps()} />)
    open()
    open()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetailMoreMenu from './DetailMoreMenu'

vi.mock('react-i18next', () => {
  const t = (k) => k
  return { useTranslation: () => ({ t }) }
})

const uiSettings = { hide_campaigns: false }
vi.mock('../../context/UISettingsContext', () => ({ useUISettings: () => uiSettings }))

let favorite = false
const toggleFavorite = vi.fn()
vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => favorite, toggleFavorite }),
}))

let canShare = true
vi.mock('../share/useCanShare', () => ({ default: () => canShare }))

// vi.hoisted: the mock factories below are hoisted above ordinary declarations.
const { dialog } = vi.hoisted(() => ({
  dialog:
    (name) =>
    ({ onClose }) => (
      <div>
        <span>{`${name}-dialog`}</span>
        <button onClick={onClose}>{`close-${name}`}</button>
      </div>
    ),
}))
vi.mock('../AddToCampaignModal', () => ({ default: dialog('campaign') }))
vi.mock('../share/ShareLinkDialog', () => ({ default: dialog('share') }))

const Otfbm = dialog('otfbm')
const otfbmItem = {
  key: 'otfbm',
  label: 'maps.otfbm.menuLabel',
  icon: null,
  requiresShare: true,
  render: (onClose) => <Otfbm onClose={onClose} />,
}
const renderMenu = (props = {}) =>
  render(
    <DetailMoreMenu
      resourceType="map"
      resourceId="m1"
      title="village.png"
      extraItems={[otfbmItem]}
      {...props}
    />
  )
const openMenu = () => userEvent.click(screen.getByLabelText('bookActions.menu'))
const items = () => screen.getAllByRole('menuitem').map((el) => el.textContent.trim())

beforeEach(() => {
  vi.clearAllMocks()
  uiSettings.hide_campaigns = false
  favorite = false
  canShare = true
})

describe('DetailMoreMenu', () => {
  it('stays closed until the trigger is clicked', async () => {
    renderMenu()
    expect(screen.queryByRole('menu')).toBeNull()
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('lists favourite, campaign, share and OTFBM for someone who may share', async () => {
    renderMenu()
    await openMenu()
    expect(items()).toEqual([
      'common.addToFavorites',
      'resources.addToCampaign',
      'share.button',
      'maps.otfbm.menuLabel',
    ])
  })

  // OTFBM is a share link to the resized background, so it goes with sharing.
  it('hides both sharing entries from someone who may not share', async () => {
    canShare = false
    renderMenu()
    await openMenu()
    expect(items()).toEqual(['common.addToFavorites', 'resources.addToCampaign'])
  })

  it('shows an extra entry that needs no share permission to everyone', async () => {
    canShare = false
    renderMenu({ extraItems: [{ ...otfbmItem, requiresShare: false }] })
    await openMenu()
    expect(items()).toContain('maps.otfbm.menuLabel')
  })

  it('works for any media type with no extras', async () => {
    render(<DetailMoreMenu resourceType="token" resourceId="t1" title="goblin.png" />)
    await openMenu()
    expect(items()).toEqual(['common.addToFavorites', 'resources.addToCampaign', 'share.button'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'common.addToFavorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith('token', 't1')
  })

  it('hides Add to campaign when campaigns are hidden', async () => {
    uiSettings.hide_campaigns = true
    renderMenu()
    await openMenu()
    expect(items()).not.toContain('resources.addToCampaign')
  })

  it('toggles the favourite and closes', async () => {
    favorite = true
    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'common.removeFromFavorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith('map', 'm1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['resources.addToCampaign', 'campaign'],
    ['share.button', 'share'],
    ['maps.otfbm.menuLabel', 'otfbm'],
  ])('opens and closes the %s dialog', async (label, name) => {
    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(screen.getByText(`${name}-dialog`)).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(screen.getByText(`close-${name}`))
    expect(screen.queryByText(`${name}-dialog`)).toBeNull()
  })

  it('closes on Escape and on an outside click', async () => {
    renderMenu()
    await openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    await openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

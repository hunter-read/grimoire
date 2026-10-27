import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SendVttToCampaignDialog, { isMapCategory } from './SendVttToCampaignDialog'
import { campaigns as campaignsApi } from '../../../api'

vi.mock('../../../api', () => ({
  default: {},
  campaigns: { list: vi.fn(), listCategories: vi.fn(), uploadFile: vi.fn() },
  mediaUrl: (p) => p,
}))
vi.mock('react-i18next', () => ({
  // A fresh `t` identity per render, exactly as i18next gives — which is what
  // catches an effect that wrongly depends on it.
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const mine = { id: 'c1', name: 'Dragons', owner_id: 'u1', is_archived: false }

const renderDialog = (props = {}) =>
  render(
    <SendVttToCampaignDialog
      userId="u1"
      onClose={props.onClose || (() => {})}
      onChoose={props.onChoose || (() => {})}
      busy={props.busy}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  campaignsApi.list.mockResolvedValue([mine])
  campaignsApi.listCategories.mockResolvedValue([])
})

describe('isMapCategory', () => {
  it.each(['Maps', 'map', 'Battlemaps', 'Karten', 'Mapas', 'Cartes', 'Kaarten'])(
    'recognises %s',
    (name) => expect(isMapCategory(name)).toBe(true)
  )

  it.each(['Handouts', 'NPCs', '', null])('does not match %s', (name) =>
    expect(isMapCategory(name)).toBe(false)
  )
})

describe('SendVttToCampaignDialog', () => {
  it('fetches the campaign list exactly once', async () => {
    renderDialog()
    await screen.findByText('Dragons')
    // `t` changes identity on every render, so an effect depending on it would
    // refetch forever — this is the guard against that regression.
    await waitFor(() => expect(campaignsApi.list).toHaveBeenCalledTimes(1))
  })

  it('offers only campaigns the viewer owns', async () => {
    campaignsApi.list.mockResolvedValue([
      mine,
      { id: 'c2', name: 'Someone else’s', owner_id: 'u2', is_archived: false },
    ])
    renderDialog()
    await screen.findByText('Dragons')
    // The upload endpoint is guarded by assert_can_manage, so offering a game
    // they merely play in would be offering something the server refuses.
    expect(screen.queryByText('Someone else’s')).toBeNull()
  })

  it('leaves out archived campaigns', async () => {
    campaignsApi.list.mockResolvedValue([{ ...mine, is_archived: true }])
    renderDialog()
    expect(await screen.findByText('maps.vtt.send.noCampaigns')).toBeInTheDocument()
  })

  it('loads that campaign’s categories once chosen', async () => {
    campaignsApi.listCategories.mockResolvedValue([{ id: 'cat1', name: 'Handouts' }])
    renderDialog()
    await userEvent.click(await screen.findByText('Dragons'))
    expect(await screen.findByText('Handouts')).toBeInTheDocument()
    expect(campaignsApi.listCategories).toHaveBeenCalledWith('c1', 'resource')
    await waitFor(() => expect(campaignsApi.listCategories).toHaveBeenCalledTimes(1))
  })

  it('marks a maps-like category as the suggestion', async () => {
    campaignsApi.listCategories.mockResolvedValue([
      { id: 'cat1', name: 'Handouts' },
      { id: 'cat2', name: 'Maps' },
    ])
    renderDialog()
    await userEvent.click(await screen.findByText('Dragons'))
    expect(await screen.findByText('maps.vtt.send.suggested')).toBeInTheDocument()
    // Listed once as the suggestion, not again in the plain list below it.
    expect(screen.getAllByText('Maps')).toHaveLength(1)
  })

  it('reports the chosen campaign and category', async () => {
    const onChoose = vi.fn()
    campaignsApi.listCategories.mockResolvedValue([{ id: 'cat2', name: 'Maps' }])
    renderDialog({ onChoose })
    await userEvent.click(await screen.findByText('Dragons'))
    await userEvent.click(await screen.findByText('Maps'))
    expect(onChoose).toHaveBeenCalledWith({ campaignId: 'c1', categoryId: 'cat2' })
  })

  it('reports a null category for the default group', async () => {
    const onChoose = vi.fn()
    renderDialog({ onChoose })
    await userEvent.click(await screen.findByText('Dragons'))
    await userEvent.click(await screen.findByText('maps.vtt.send.defaultCategory'))
    expect(onChoose).toHaveBeenCalledWith({ campaignId: 'c1', categoryId: null })
  })

  it('treats a category fetch failure as simply having none', async () => {
    campaignsApi.listCategories.mockRejectedValue(new Error('nope'))
    renderDialog()
    await userEvent.click(await screen.findByText('Dragons'))
    // A campaign with no categories is the normal case, not an error.
    expect(await screen.findByText('maps.vtt.send.defaultCategory')).toBeInTheDocument()
  })

  it('steps back to the campaign list', async () => {
    renderDialog()
    await userEvent.click(await screen.findByText('Dragons'))
    await screen.findByText('maps.vtt.send.defaultCategory')
    await userEvent.click(screen.getByText('common.back'))
    expect(await screen.findByText('Dragons')).toBeInTheDocument()
  })

  it('Escape steps back before it closes', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await userEvent.click(await screen.findByText('Dragons'))
    await screen.findByText('maps.vtt.send.defaultCategory')

    // Dispatched at the panel rather than the window: the handler lives there
    // on purpose, so a keystroke bubbling from whatever is behind the dialog
    // does not drive it.
    const panel = screen.getByRole('dialog')
    fireEvent.keyDown(panel, { key: 'Escape' })
    // One keystroke should not cost a user their whole way through the dialog.
    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByText('Dragons')).toBeInTheDocument()

    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when the viewer runs no campaigns', async () => {
    campaignsApi.list.mockResolvedValue([])
    renderDialog()
    expect(await screen.findByText('maps.vtt.send.noCampaigns')).toBeInTheDocument()
  })

  it('surfaces a failed campaign load', async () => {
    campaignsApi.list.mockRejectedValue(new Error('offline'))
    renderDialog()
    expect(await screen.findByText('offline')).toBeInTheDocument()
    // The "no campaigns" line would be misleading here: there may well be some.
    expect(screen.queryByText('maps.vtt.send.noCampaigns')).toBeNull()
  })

  it('disables the choices while an upload is in flight', async () => {
    renderDialog({ busy: true })
    await userEvent.click(await screen.findByText('Dragons'))
    const row = await screen.findByText('maps.vtt.send.defaultCategory')
    expect(row.closest('button')).toBeDisabled()
  })
})

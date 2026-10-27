import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareLinkDialog from './ShareLinkDialog'
import ShareLinkButton from './ShareLinkButton'
import type { ComponentProps } from 'react'
import { auth, shareLinks, type Schema } from '../../api'
import { UISettingsProvider } from '../../context/UISettingsContext'
import { clearPasswordRulesCache } from '../../hooks/usePasswordRules'

vi.mock('../../api', () => ({
  auth: { status: vi.fn() },
  shareLinks: { list: vi.fn(), create: vi.fn(), revoke: vi.fn(), remove: vi.fn() },
}))
// Keys come back as-is; a `min` passed with one is shown after it.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { min?: number }) => (opts?.min !== undefined ? `${k} (${opts.min})` : k),
    i18n: { language: 'en-US' },
  }),
}))
let authUser: { share_links_allowed: boolean } | null = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser }),
}))

const existing: Schema<'ShareLinkOut'> = {
  id: 'l1',
  resource_id: 'm1',
  url: 'u1',
  file_url: 'f1',
  resource_type: 'map',
  resource_name: 'Tavern',
  label: 'Old one',
  filename: 'tavern.png',
  has_password: false,
  state: 'active',
  use_count: 1,
}

const status = (shareMin: number) => ({
  initialized: true,
  password_min_length: 12,
  share_link_password_min_length: shareMin,
})

beforeEach(() => {
  vi.resetAllMocks()
  clearPasswordRulesCache()
  authUser = null
  vi.mocked(shareLinks.list).mockResolvedValue([existing])
  vi.mocked(auth.status).mockResolvedValue(status(8))
})

const renderDialog = (props: Partial<ComponentProps<typeof ShareLinkDialog>> = {}) =>
  render(
    <ShareLinkDialog
      resourceType="map"
      resourceId="m1"
      title="Tavern"
      onClose={vi.fn()}
      {...props}
    />
  )

describe('ShareLinkDialog', () => {
  it('lists my links for this item', async () => {
    renderDialog()
    expect(await screen.findByText('Old one')).toBeInTheDocument()
    expect(shareLinks.list).toHaveBeenCalledWith({ resource_type: 'map', resource_id: 'm1' })
  })

  it('creates a link with the chosen expiry and password and puts it first', async () => {
    vi.mocked(shareLinks.create).mockResolvedValue({ ...existing, id: 'l2', label: 'Fresh' })
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.change(screen.getByPlaceholderText('share.form.labelPlaceholder'), {
      target: { value: ' Fresh ' },
    })
    fireEvent.change(screen.getByDisplayValue('share.expiry.week'), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('share.form.passwordPlaceholder'), {
      target: { value: 'secret12' },
    })
    fireEvent.click(screen.getByText('share.form.create'))
    await waitFor(() =>
      expect(shareLinks.create).toHaveBeenCalledWith({
        resource_type: 'map',
        resource_id: 'm1',
        label: 'Fresh',
        expires_in_days: null,
        password: 'secret12',
      })
    )
    const labels = (await screen.findAllByText(/Fresh|Old one/)).map((n) => n.textContent)
    expect(labels).toEqual(['Fresh', 'Old one'])
  })

  it('offers 90- and 365-day expiries', async () => {
    vi.mocked(shareLinks.create).mockResolvedValue({ ...existing, id: 'l4' })
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.change(screen.getByDisplayValue('share.expiry.week'), { target: { value: '365' } })
    fireEvent.click(screen.getByText('share.form.create'))
    await waitFor(() =>
      expect(shareLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ expires_in_days: 365 })
      )
    )
  })

  it('sends a 7-day expiry by default and no password', async () => {
    vi.mocked(shareLinks.create).mockResolvedValue({ ...existing, id: 'l3' })
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.click(screen.getByText('share.form.create'))
    await waitFor(() =>
      expect(shareLinks.create).toHaveBeenCalledWith({
        resource_type: 'map',
        resource_id: 'm1',
        label: '',
        expires_in_days: 7,
      })
    )
  })

  it('refuses a password shorter than 8 characters by default', async () => {
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.change(screen.getByPlaceholderText('share.form.passwordPlaceholder'), {
      target: { value: 'sevenxx' },
    })
    expect(screen.getByText('share.form.passwordTooShort (8)')).toBeInTheDocument()
    expect(screen.getByText('share.form.create')).toBeDisabled()
  })

  it("uses the server's share-link minimum when it has been changed", async () => {
    vi.mocked(auth.status).mockResolvedValue(status(4))
    renderDialog()
    await screen.findByText('Old one')
    const input = screen.getByPlaceholderText('share.form.passwordPlaceholder')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(await screen.findByText('share.form.passwordTooShort (4)')).toBeInTheDocument()
    expect(screen.getByText('share.form.create')).toBeDisabled()

    // Four characters is enough on this server.
    fireEvent.change(input, { target: { value: 'abcd' } })
    expect(screen.queryByText(/share\.form\.passwordTooShort/)).toBeNull()
    expect(screen.getByText('share.form.create')).toBeEnabled()
  })

  it("shows the server's reason when it refuses a password as too common", async () => {
    vi.mocked(shareLinks.create).mockRejectedValue(
      new Error('That password is too common - choose one that is harder to guess')
    )
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.change(screen.getByPlaceholderText('share.form.passwordPlaceholder'), {
      target: { value: 'password' },
    })
    fireEvent.click(screen.getByText('share.form.create'))
    expect(
      await screen.findByText('That password is too common - choose one that is harder to guess')
    ).toBeInTheDocument()
  })

  it('shows a create failure', async () => {
    vi.mocked(shareLinks.create).mockRejectedValue(new Error('not allowed'))
    renderDialog()
    await screen.findByText('Old one')
    fireEvent.click(screen.getByText('share.form.create'))
    expect(await screen.findByText('not allowed')).toBeInTheDocument()
  })

  it('shows a load failure and an empty list', async () => {
    vi.mocked(shareLinks.list).mockRejectedValue(new Error(''))
    renderDialog()
    expect(await screen.findByText('share.loadFailed')).toBeInTheDocument()
    expect(screen.getByText('share.dialog.none')).toBeInTheDocument()
  })

  it('closes on Escape, the close button and the backdrop', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await screen.findByText('Old one')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('common.close'))
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('ShareLinkButton', () => {
  const renderButton = (enabled = true) =>
    render(
      <UISettingsProvider
        value={
          { share_links_enabled: enabled } as ComponentProps<typeof UISettingsProvider>['value']
        }
      >
        <ShareLinkButton resourceType="token" resourceId="t1" title="Goblin" />
      </UISettingsProvider>
    )

  it('is hidden from someone who may not share', () => {
    authUser = { share_links_allowed: false }
    renderButton()
    expect(screen.queryByText('share.button')).toBeNull()
  })

  it('is hidden when the instance has share links off', () => {
    authUser = { share_links_allowed: true }
    renderButton(false)
    expect(screen.queryByText('share.button')).toBeNull()
  })

  it('opens the dialog for someone who may', async () => {
    authUser = { share_links_allowed: true }
    vi.mocked(shareLinks.list).mockResolvedValue([])
    renderButton()
    fireEvent.click(screen.getByText('share.button'))
    expect(await screen.findByText('share.dialog.title')).toBeInTheDocument()
    expect(shareLinks.list).toHaveBeenCalledWith({ resource_type: 'token', resource_id: 't1' })
    fireEvent.click(screen.getByLabelText('common.close'))
    expect(screen.queryByText('share.dialog.title')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShareLinksSection from './ShareLinksSection'
import UserShareLinksList from './UserShareLinksList'
import { shareLinks } from '../../api'

vi.mock('../../api', () => ({
  shareLinks: { list: vi.fn(), listForUser: vi.fn(), revoke: vi.fn(), remove: vi.fn() },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'en-US' } }),
}))

const link = {
  id: 'l1',
  url: 'u',
  file_url: 'f',
  resource_type: 'book',
  resource_name: 'Core Rules',
  label: '',
  filename: 'core.pdf',
  has_password: false,
  state: 'suspended',
  use_count: 0,
}

beforeEach(() => vi.resetAllMocks())

describe('ShareLinksSection', () => {
  it('lists my links across items', async () => {
    shareLinks.list.mockResolvedValue([link])
    render(<ShareLinksSection canShare />)
    expect(await screen.findByText('Core Rules')).toBeInTheDocument()
    expect(screen.getByText('userSettings.shareLinks.description')).toBeInTheDocument()
  })

  it('explains paused links to someone without the permission', async () => {
    shareLinks.list.mockResolvedValue([])
    render(<ShareLinksSection canShare={false} />)
    expect(screen.getByText('userSettings.shareLinks.noPermission')).toBeInTheDocument()
    expect(await screen.findByText('userSettings.shareLinks.none')).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    shareLinks.list.mockRejectedValue(new Error('down'))
    render(<ShareLinksSection canShare />)
    expect(await screen.findByText('down')).toBeInTheDocument()
  })
})

describe('UserShareLinksList', () => {
  it("lists one user's links", async () => {
    shareLinks.listForUser.mockResolvedValue([link])
    render(<UserShareLinksList userId="u9" />)
    expect(await screen.findByText('Core Rules')).toBeInTheDocument()
    expect(shareLinks.listForUser).toHaveBeenCalledWith('u9')
  })

  it('shows an empty state and failures', async () => {
    shareLinks.listForUser.mockRejectedValue(new Error(''))
    render(<UserShareLinksList userId="u9" />)
    expect(await screen.findByText('share.loadFailed')).toBeInTheDocument()
    expect(screen.getByText('users.shareLinks.none')).toBeInTheDocument()
  })
})

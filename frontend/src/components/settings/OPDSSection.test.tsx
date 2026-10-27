import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OPDSSection from './OPDSSection'
import { opds } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

vi.mock('../../api', () => ({
  opds: {
    getStatus: vi.fn(),
    generateToken: vi.fn(),
    revokeToken: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

describe('OPDSSection', () => {
  it('renders nothing when OPDS is disabled server-side', async () => {
    opds.getStatus.mockResolvedValue({ opds_enabled: false })
    const { container } = render(<OPDSSection />)
    await waitFor(() => expect(opds.getStatus).toHaveBeenCalled())
    expect(container.querySelector('h3')).toBeNull()
  })

  it('shows the enable button and generates a token', async () => {
    opds.getStatus.mockResolvedValue({ opds_enabled: true, has_token: false })
    opds.generateToken.mockResolvedValue({
      opds_enabled: true,
      has_token: true,
      feed_url: 'http://feed',
    })
    render(<OPDSSection />)
    await userEvent.click(await screen.findByText('userSettings.opds.enable'))
    await waitFor(() => expect(opds.generateToken).toHaveBeenCalled())
    // After generating, the feed URL is shown.
    expect(screen.getByLabelText('userSettings.opds.feedUrl').value).toBe('http://feed')
  })

  it('copies the feed URL to the clipboard', async () => {
    opds.getStatus.mockResolvedValue({
      opds_enabled: true,
      has_token: true,
      feed_url: 'http://feed',
    })
    render(<OPDSSection />)
    await userEvent.click(await screen.findByTitle('userSettings.opds.copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://feed')
    expect(screen.getByText('userSettings.opds.copied')).toBeInTheDocument()
  })

  it('confirms and revokes the token', async () => {
    opds.getStatus.mockResolvedValue({
      opds_enabled: true,
      has_token: true,
      feed_url: 'http://feed',
    })
    opds.revokeToken.mockResolvedValue({ opds_enabled: true, has_token: false })
    render(<OPDSSection />)
    await userEvent.click(await screen.findByText('userSettings.opds.disable'))
    await userEvent.click(screen.getByText('userSettings.opds.confirmDisable'))
    await waitFor(() => expect(opds.revokeToken).toHaveBeenCalled())
    // Back to the enable button once the token is gone.
    expect(screen.getByText('userSettings.opds.enable')).toBeInTheDocument()
  })

  it('can cancel the revoke confirmation', async () => {
    opds.getStatus.mockResolvedValue({
      opds_enabled: true,
      has_token: true,
      feed_url: 'http://feed',
    })
    render(<OPDSSection />)
    await userEvent.click(await screen.findByText('userSettings.opds.disable'))
    await userEvent.click(screen.getByText('common.cancel'))
    expect(screen.queryByText('userSettings.opds.confirmDisable')).not.toBeInTheDocument()
  })

  describe('feed version dropdown', () => {
    const feeds = {
      opds_enabled: true,
      has_token: true,
      feed_url: 'http://x/opds/tok',
      feed_urls: [
        { version: 'v2', url: 'http://x/opds/v2/tok' },
        { version: 'v1', url: 'http://x/opds/tok' },
      ],
    }

    it('shows the newest version by default', async () => {
      opds.getStatus.mockResolvedValue(feeds)
      render(<OPDSSection />)
      const select = await screen.findByLabelText('userSettings.opds.version')
      expect(select.value).toBe('v2')
      expect(screen.getByLabelText('userSettings.opds.feedUrl').value).toBe('http://x/opds/v2/tok')
      expect(screen.getByText('userSettings.opds.versionHints.v2')).toBeInTheDocument()
    })

    it('lists every version the server offers', async () => {
      opds.getStatus.mockResolvedValue(feeds)
      render(<OPDSSection />)
      await screen.findByLabelText('userSettings.opds.version')
      const options = screen.getAllByRole('option').map((o) => o.textContent)
      expect(options).toEqual(['userSettings.opds.versions.v2', 'userSettings.opds.versions.v1'])
    })

    it('switches the shown and copied URL to the chosen version', async () => {
      opds.getStatus.mockResolvedValue(feeds)
      render(<OPDSSection />)
      await userEvent.selectOptions(await screen.findByLabelText('userSettings.opds.version'), 'v1')
      expect(screen.getByLabelText('userSettings.opds.feedUrl').value).toBe('http://x/opds/tok')
      expect(screen.getByText('userSettings.opds.versionHints.v1')).toBeInTheDocument()
      await userEvent.click(screen.getByTitle('userSettings.opds.copy'))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://x/opds/tok')
    })

    it('keeps the chosen version across a regenerate', async () => {
      opds.getStatus.mockResolvedValue(feeds)
      opds.generateToken.mockResolvedValue({
        ...feeds,
        feed_url: 'http://x/opds/new',
        feed_urls: [
          { version: 'v2', url: 'http://x/opds/v2/new' },
          { version: 'v1', url: 'http://x/opds/new' },
        ],
      })
      render(<OPDSSection />)
      await userEvent.selectOptions(await screen.findByLabelText('userSettings.opds.version'), 'v1')
      await userEvent.click(screen.getByText('userSettings.opds.regenerate'))
      await waitFor(() =>
        expect(screen.getByLabelText('userSettings.opds.feedUrl').value).toBe('http://x/opds/new')
      )
    })

    it('hides the dropdown when the server sends no version list', async () => {
      opds.getStatus.mockResolvedValue({
        opds_enabled: true,
        has_token: true,
        feed_url: 'http://feed',
      })
      render(<OPDSSection />)
      expect((await screen.findByLabelText('userSettings.opds.feedUrl')).value).toBe('http://feed')
      expect(screen.queryByLabelText('userSettings.opds.version')).not.toBeInTheDocument()
    })
  })
})

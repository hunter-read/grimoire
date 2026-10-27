import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CampaignCard from './CampaignCard'

// Mirror the real bannerUrl: media URLs carry no ?token= (auth is via the
// HttpOnly cookie), so `v` must be attached as a real query param — a plain
// string concat of "&v=" would produce a malformed, unroutable URL.
vi.mock('../../api', () => ({
  campaigns: {
    bannerUrl: (id, v) => `/api/campaigns/${id}/banner${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  },
}))
vi.mock('./WikiMarkdown', () => ({
  default: ({ body }) => <div data-testid="wiki">{body}</div>,
}))
vi.mock('./CampaignRoleBadge', () => ({ default: ({ label }) => <span>{label}</span> }))

beforeEach(() => vi.clearAllMocks())

const campaign = (over = {}) => ({
  id: 'c1',
  name: 'Curse of Strahd',
  owner_id: 'u1',
  members: [],
  has_banner: false,
  updated_at: '2026-01-01T00:00:00',
  ...over,
})

function renderCard(props) {
  return render(
    <MemoryRouter>
      <CampaignCard {...props} />
    </MemoryRouter>
  )
}

describe('CampaignCard', () => {
  it('renders the campaign name', () => {
    renderCard({ campaign: campaign() })
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
  })

  it('renders a CardLink overlay to the campaign overview', () => {
    renderCard({ campaign: campaign() })
    // CardLink renders an <a> with aria-label="Open campaign {name}"
    const link = screen.getByRole('link', { name: /open campaign curse of strahd/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/campaigns/c1/overview')
  })

  it('renders a cache-busted banner (lazy) when has_banner', () => {
    const { container } = renderCard({ campaign: campaign({ has_banner: true }) })
    const img = container.querySelector('img')
    // The cache-buster must be a real query param (leading '?'), not a bare
    // '&v=' appended to the path, or the URL doesn't route on the backend.
    expect(img.getAttribute('src')).toBe('/api/campaigns/c1/banner?v=2026-01-01T00%3A00%3A00')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders the description via WikiMarkdown and the badge label', () => {
    renderCard({
      campaign: campaign({ description: 'Gothic horror' }),
      badgeLabel: 'GM',
    })
    expect(screen.getByTestId('wiki')).toHaveTextContent('Gothic horror')
    expect(screen.getByText('GM')).toBeInTheDocument()
  })

  it('formats an upcoming session date', () => {
    renderCard({ campaign: campaign({ next_session: '2026-08-15' }) })
    expect(screen.getByText(/Aug/)).toBeInTheDocument()
  })

  it('shows the player count for a GM campaign owned by the viewer', () => {
    renderCard({
      campaign: campaign({
        is_gm_campaign: true,
        members: [
          { status: 'accepted', is_owner: false },
          { status: 'accepted', is_owner: false },
          { status: 'pending', is_owner: false },
        ],
      }),
      userId: 'u1',
    })
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })

  it('marks an archived campaign with a badge', () => {
    renderCard({ campaign: campaign({ is_archived: true }) })
    expect(screen.getByText(/archived/i)).toBeInTheDocument()
  })

  it('shows no archived badge on an active campaign', () => {
    renderCard({ campaign: campaign() })
    expect(screen.queryByText(/archived/i)).toBeNull()
  })

  // Issue #313 — the card and its Open Notes button are real links now.
  // Native browser behavior handles middle click / ctrl-click (new tab) without JS.
  describe('link hrefs for new-tab support', () => {
    it('card overlay link points to the campaign overview', () => {
      renderCard({ campaign: campaign() })
      const link = screen.getByRole('link', { name: /open campaign curse of strahd/i })
      expect(link.getAttribute('href')).toBe('/campaigns/c1/overview')
    })

    it('Open Notes link points to the notes page, not the overview', () => {
      renderCard({ campaign: campaign() })
      const notesLink = screen.getByRole('link', { name: /notes/i })
      expect(notesLink.getAttribute('href')).toBe('/campaigns/c1/notes')
    })

    it('Open Notes link leads to a different URL than the card overlay', () => {
      renderCard({ campaign: campaign() })
      const cardLink = screen.getByRole('link', { name: /open campaign/i })
      const notesLink = screen.getByRole('link', { name: /notes/i })
      expect(notesLink.getAttribute('href')).not.toBe(cardLink.getAttribute('href'))
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MobileSidebar from './MobileSidebar'

const renderBar = (props = {}) =>
  render(
    <MemoryRouter>
      <MobileSidebar user={{ role: 'admin' }} onLogout={vi.fn()} uiSettings={{}} {...props} />
    </MemoryRouter>
  )

describe('MobileSidebar', () => {
  it('renders the audio link in the More drawer by default', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('hides the audio link when hide_audio is set', async () => {
    renderBar({ uiSettings: { hide_audio: true } })
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.queryByText('Audio')).not.toBeInTheDocument()
  })

  it('lists maps, tokens, audio and settings in the drawer', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.getByText('Maps')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
    expect(screen.getByText(/settings/i)).toBeInTheDocument()
  })

  it('lists the Tags link in the drawer pointing at /tags (issue #235)', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    const tagsLink = screen.getByRole('link', { name: /tags/i })
    expect(tagsLink).toHaveAttribute('href', '/tags')
  })

  it('closes the drawer when a drawer item is clicked', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    await userEvent.click(screen.getByText('Audio'))
    // Drawer collapses — Audio link no longer shown.
    expect(screen.queryByText('Audio')).not.toBeInTheDocument()
  })

  it('hides maps and tokens when those sections are hidden', async () => {
    renderBar({ uiSettings: { hide_maps: true, hide_tokens: true } })
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.queryByText('Maps')).not.toBeInTheDocument()
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('renders the primary nav links (library, search, favorites)', () => {
    renderBar()
    expect(screen.getByText(/library/i)).toBeInTheDocument()
    expect(screen.getByText(/search/i)).toBeInTheDocument()
  })

  it('logs out from the drawer', async () => {
    const onLogout = vi.fn()
    renderBar({ onLogout })
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    // The drawer's log-out button (distinct from any bottom-bar control).
    const logout = screen.getAllByText(/log out/i).at(-1)
    await userEvent.click(logout)
    expect(onLogout).toHaveBeenCalled()
  })

  it('closes the drawer when settings is chosen', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    await userEvent.click(screen.getByText(/settings/i))
    expect(screen.queryByText('Audio')).not.toBeInTheDocument()
  })

  it('closes the drawer when the backdrop is clicked', async () => {
    const { container } = renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.getByText('Audio')).toBeInTheDocument()
    // The overlay backdrop is the first fixed element behind the drawer.
    const backdrop = container.querySelector('[aria-hidden="true"]')
    if (backdrop) await userEvent.click(backdrop)
    expect(screen.queryByText('Audio')).not.toBeInTheDocument()
  })

  it('shows a minimal bar for guests (no More button)', () => {
    renderBar({ user: { role: 'guest' } })
    expect(screen.getByText(/log out/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument()
  })
})

describe('MobileSidebar — characters', () => {
  const renderBar = (props = {}) =>
    render(
      <MemoryRouter>
        <MobileSidebar user={{ role: 'admin' }} onLogout={vi.fn()} uiSettings={{}} {...props} />
      </MemoryRouter>
    )

  it('lists Characters in the drawer', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.getByText('Characters')).toBeInTheDocument()
    // Rulesets are reached from within Characters, not from the drawer.
    expect(screen.queryByText('Rulesets')).not.toBeInTheDocument()
  })

  it('hides maps, tokens and models when their settings are set', async () => {
    renderBar({ uiSettings: { hide_maps: true, hide_tokens: true, hide_models: true } })
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.queryByText('Maps')).not.toBeInTheDocument()
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument()
    expect(screen.queryByText('Models')).not.toBeInTheDocument()
    // The ones that are not hidden remain.
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('closes the drawer when a link in it is chosen', async () => {
    renderBar()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    await userEvent.click(screen.getByText('Characters'))
    expect(screen.queryByText('Audio')).not.toBeInTheDocument()
  })

  it('hides characters when campaigns are hidden', async () => {
    // Characters sit with Campaigns rather than carrying their own toggle, so
    // the one setting governs both.
    renderBar({ uiSettings: { hide_campaigns: true } })
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.queryByText('Campaigns')).not.toBeInTheDocument()
    expect(screen.queryByText('Characters')).not.toBeInTheDocument()
  })
})

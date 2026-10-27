import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareView from './ShareView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
    i18n: { language: 'en-US' },
  }),
}))

const ready = (over: Record<string, unknown> = {}) => ({
  password_required: false,
  unlocked: true,
  resource_type: 'map',
  name: 'Old Tavern',
  label: 'Session 4',
  filename: 'old-tavern.png',
  media_type: 'image/png',
  media_kind: 'image',
  file_size: 2048,
  file_url: '/api/share/tok/old-tavern.png',
  download_url: '/api/share/tok/old-tavern.png?download=1',
  expires_at: '2026-10-20T00:00:00Z',
  ...over,
})

const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

describe('ShareView', () => {
  it('shows an image with download and open buttons', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(respond(200, ready()))
    render(<ShareView token="tok" />)
    expect(await screen.findByText('Old Tavern')).toBeInTheDocument()
    expect(screen.getByText('Session 4')).toBeInTheDocument()
    expect(screen.getByAltText('Old Tavern')).toHaveAttribute('src', ready().file_url)
    expect(screen.getByText(/sharePage.download/).closest('a')).toHaveAttribute(
      'href',
      ready().download_url
    )
    expect(screen.getByText(/sharePage.open/).closest('a')).toHaveAttribute('target', '_blank')
    expect(fetch).toHaveBeenCalledWith('/api/share/tok/meta', expect.anything())
    // The title is set in an effect after the name renders, so it is waited
    // for on its own rather than assumed to have landed with the name.
    await waitFor(() => expect(document.title).toBe('Old Tavern - Grimoire'))
  })

  it('plays audio', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(
      respond(200, ready({ media_kind: 'audio', expires_at: null }))
    )
    const { container } = render(<ShareView token="tok" />)
    await screen.findByText('Old Tavern')
    expect(container.querySelector('audio')).toHaveAttribute('src', ready().file_url)
    expect(screen.queryByText(/sharePage.open/)).toBeNull()
  })

  it('plays video', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(respond(200, ready({ media_kind: 'video' })))
    const { container } = render(<ShareView token="tok" />)
    await screen.findByText('Old Tavern')
    expect(container.querySelector('video')).toBeInTheDocument()
  })

  it('shows a file card for anything else', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(
      respond(200, ready({ media_kind: 'model', file_size: null, label: '' }))
    )
    render(<ShareView token="tok" />)
    expect(await screen.findByText('old-tavern.png')).toBeInTheDocument()
  })

  it('says a dead link does not work, without saying why', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(respond(404, { detail: 'Not found' }))
    render(<ShareView token="tok" />)
    expect(await screen.findByText('sharePage.missingTitle')).toBeInTheDocument()
    expect(screen.getByText('sharePage.missingBody')).toBeInTheDocument()
  })

  it('says when it is being throttled', async () => {
    ;(fetch as unknown as Mock).mockReturnValue(respond(429, {}))
    render(<ShareView token="tok" />)
    expect(await screen.findByText('sharePage.throttled')).toBeInTheDocument()
  })

  it('asks for the password, then shows the item', async () => {
    ;(fetch as unknown as Mock)
      .mockReturnValueOnce(respond(200, { password_required: true, unlocked: false }))
      .mockReturnValueOnce(respond(403, { detail: 'Wrong password' }))
      .mockReturnValueOnce(respond(200, { unlocked: true }))
      .mockReturnValueOnce(respond(200, ready({ password_required: true })))
    render(<ShareView token="tok" />)
    const input = await screen.findByLabelText('sharePage.password')
    expect(screen.getByText('sharePage.unlock')).toBeDisabled()
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.click(screen.getByText('sharePage.unlock'))
    expect(await screen.findByText('sharePage.wrongPassword')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'open sesame' } })
    fireEvent.click(screen.getByText('sharePage.unlock'))
    expect(await screen.findByText('Old Tavern')).toBeInTheDocument()
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/share/tok/unlock',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'open sesame' }),
        })
      )
    )
  })

  it('reports a throttled unlock', async () => {
    ;(fetch as unknown as Mock)
      .mockReturnValueOnce(respond(200, { password_required: true, unlocked: false }))
      .mockReturnValueOnce(respond(429, {}))
    render(<ShareView token="tok" />)
    fireEvent.change(await screen.findByLabelText('sharePage.password'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByText('sharePage.unlock'))
    expect(await screen.findByText('sharePage.throttled')).toBeInTheDocument()
  })
})

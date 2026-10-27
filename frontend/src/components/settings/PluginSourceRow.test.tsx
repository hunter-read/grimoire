import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PluginSourceRow from './PluginSourceRow'
import { addons } from '../../api'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({
  addons: { setSourceCredential: vi.fn(), clearSourceCredential: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : k),
  }),
}))

describe('PluginSourceRow', () => {
  const url = 'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json'
  const data = {
    trusted_index_urls: [url],
    default_index_url: url,
    source_contents: {
      [url]: ['plugins', 'themes', 'templates'],
    },
  } as unknown as Schema<'AddonListResponse'>

  it('renders repository name, link, verified icon, and content labels', () => {
    const { container } = render(
      <PluginSourceRow url={url} index={0} data={data} busy={false} onRemove={vi.fn()} />
    )
    expect(screen.getByText('grimoire-codex/community-add-ons')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', url)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Plugins')).toBeInTheDocument()
    expect(screen.getByText('Themes')).toBeInTheDocument()
    expect(screen.getByText('Templates')).toBeInTheDocument()
  })

  it('labels character sheets rather than falling through to Templates', () => {
    // The old chain of ternaries ended in Templates, so any type it did not
    // recognise rendered as the wrong label.
    render(
      <PluginSourceRow
        url={url}
        index={0}
        data={{ ...data, source_contents: { [url]: ['character-sheets'] } }}
        busy={false}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('Character sheets')).toBeInTheDocument()
    expect(screen.queryByText('Templates')).not.toBeInTheDocument()
  })

  it('shows an unrecognised content type as itself', () => {
    render(
      <PluginSourceRow
        url={url}
        index={0}
        data={{ ...data, source_contents: { [url]: ['something-new'] } }}
        busy={false}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('something-new')).toBeInTheDocument()
  })

  it('marks a source that has an access token as private', () => {
    render(
      <PluginSourceRow
        url={url}
        index={0}
        data={{
          ...data,
          source_credentials: {
            [url]: { header: 'Authorization', env_locked: false, unreadable: false },
          },
        }}
        busy={false}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('addons.privateSource')).toBeInTheDocument()
  })

  it('says when a saved token can no longer be read', () => {
    render(
      <PluginSourceRow
        url={url}
        index={0}
        data={{
          ...data,
          source_credentials: {
            [url]: { header: 'Authorization', env_locked: false, unreadable: true },
          },
        }}
        busy={false}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('addons.tokenNeedsReentry')).toBeInTheDocument()
  })

  it('shows the private badge once a token is saved, without a reload', async () => {
    vi.mocked(addons.setSourceCredential).mockResolvedValue({
      source_credentials: {
        [url]: { header: 'Authorization', env_locked: false, unreadable: false },
      },
    })
    render(<PluginSourceRow url={url} index={0} data={data} busy={false} onRemove={vi.fn()} />)
    expect(screen.queryByText('addons.privateSource')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenButton' }))
    fireEvent.change(screen.getByLabelText('addons.tokenLabel'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenSave' }))

    expect(await screen.findByText('addons.privateSource')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the token dialog on cancel', () => {
    render(<PluginSourceRow url={url} index={0} data={data} busy={false} onRemove={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenButton' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('triggers onRemove callback with item index when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(<PluginSourceRow url={url} index={2} data={data} busy={false} onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(2)
  })
})

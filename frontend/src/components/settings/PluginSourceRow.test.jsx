import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PluginSourceRow from './PluginSourceRow'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, fallback) => fallback || k,
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
  }

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

  it('triggers onRemove callback with item index when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(<PluginSourceRow url={url} index={2} data={data} busy={false} onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(2)
  })
})

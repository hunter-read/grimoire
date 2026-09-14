import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PluginSourceContextMenu from './PluginSourceContextMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, fallback) => fallback || k,
  }),
}))

describe('PluginSourceContextMenu', () => {
  const sampleSources = [
    {
      index_url:
        'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml',
      version: '1.0.0',
    },
    {
      index_url: 'https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json',
      version: '1.1.0',
    },
  ]

  it('renders nothing when sources array is empty or missing', () => {
    const { container } = render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders install title and source options', () => {
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={sampleSources}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Install from specific source')).toBeInTheDocument()
    expect(screen.getByText('grimoire-codex/community-add-ons')).toBeInTheDocument()
    expect(screen.getByText('user/my-repo (panda)')).toBeInTheDocument()
  })

  it('renders update title when isUpdate is true', () => {
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={true}
        sources={sampleSources}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Update from specific source')).toBeInTheDocument()
  })

  it('invokes onSelect and onClose when a source option is clicked', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByText('user/my-repo (panda)'))
    expect(onSelect).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/user/my-repo/panda/themes/index.json'
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('invokes onClose when clicking outside (window click)', () => {
    const onClose = vi.fn()
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={sampleSources}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.click(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('invokes onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={sampleSources}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders verified source title for trusted sources', () => {
    render(
      <PluginSourceContextMenu
        x={100}
        y={100}
        isUpdate={false}
        sources={sampleSources}
        defaultIndexUrl="https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml"
        trustedIndexUrls={[
          'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml',
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTitle('Verified Source')).toBeInTheDocument()
  })
})

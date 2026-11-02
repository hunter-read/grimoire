import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PluginSourceContextMenu from './PluginSourceContextMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) => fallback || k,
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

  describe('from the keyboard', () => {
    function Opener({ onClose = vi.fn(), onSelect = vi.fn() }) {
      return (
        <PluginSourceContextMenu
          x={0}
          y={0}
          sources={sampleSources}
          onSelect={onSelect}
          onClose={onClose}
        />
      )
    }

    it('is a named menu whose first source takes focus', () => {
      render(<Opener />)
      const menu = screen.getByRole('menu', { name: 'Install from specific source' })
      const items = screen.getAllByRole('menuitem')
      expect(menu).toContainElement(items[0])
      expect(items[0]).toHaveFocus()
      fireEvent.keyDown(items[0], { key: 'ArrowDown' })
      expect(items[1]).toHaveFocus()
    })

    it('hands focus back to what opened it on Escape and on a choice', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()
      const onClose = vi.fn()
      const { unmount } = render(<Opener onClose={onClose} />)
      fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
      expect(opener).toHaveFocus()
      unmount()

      opener.focus()
      const onSelect = vi.fn()
      render(<Opener onSelect={onSelect} />)
      fireEvent.click(screen.getAllByRole('menuitem')[1])
      expect(onSelect).toHaveBeenCalledWith(sampleSources[1].index_url)
      expect(opener).toHaveFocus()
      opener.remove()
    })
  })
})

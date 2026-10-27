import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PluginCard from './PluginCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) =>
      typeof opts === 'string'
        ? opts
        : opts?.author
          ? `by ${opts.author}`
          : opts?.version
            ? `v${opts.version}`
            : k,
  }),
}))

describe('PluginCard', () => {
  const installedAddon = {
    id: 'drivethrurpg',
    name: 'DriveThruRPG',
    version: '1.0.0',
    description: 'Book metadata from DriveThruRPG.',
    author: 'hunter-read',
    author_url: 'https://github.com/hunter-read',
    index_url: 'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json',
    enabled: true,
    runnable: true,
    update_available: true,
    available_version: '1.1.0',
    available_in: [
      {
        index_url:
          'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json',
      },
      { index_url: 'https://raw.githubusercontent.com/vandie/community-add-ons/main/index.json' },
    ],
  }

  const availableAddon = {
    id: 'dnd5e-spells',
    name: 'D&D 5e Spells',
    version: '2.0.0',
    description: 'Spell lookup plugin.',
    author: 'vandie',
    requires_script: true,
    index_url: 'https://raw.githubusercontent.com/vandie/community-add-ons/main/index.json',
    available_in: [],
  }

  it('renders an installed add-on card with version, update badge, menu, checkbox and remove button', () => {
    const onToggleEnabled = vi.fn()
    const onRemove = vi.fn()
    const onUpdate = vi.fn()

    render(
      <PluginCard
        addon={installedAddon}
        isInstalled={true}
        trustedIndexUrls={[installedAddon.index_url]}
        busy={false}
        onToggleEnabled={onToggleEnabled}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    )

    expect(screen.getByText('DriveThruRPG')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('Book metadata from DriveThruRPG.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleEnabled).toHaveBeenCalledWith(installedAddon)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(installedAddon)
  })

  it('renders an available add-on card with runs-code badge and install button', () => {
    const onInstall = vi.fn()

    render(
      <PluginCard addon={availableAddon} isInstalled={false} busy={false} onInstall={onInstall} />
    )

    expect(screen.getByText('D&D 5e Spells')).toBeInTheDocument()
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    expect(screen.getByText('runs code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledWith(availableAddon)
  })

  it('triggers onUpdate when update button is clicked', () => {
    const onUpdate = vi.fn()

    render(
      <PluginCard addon={installedAddon} isInstalled={true} busy={false} onUpdate={onUpdate} />
    )

    const updateBtn = screen.getByRole('button', { name: /update/i })
    expect(updateBtn).toBeInTheDocument()
    fireEvent.click(updateBtn)
    expect(onUpdate).toHaveBeenCalledWith(installedAddon)
  })

  it('triggers onContextMenu on right click or more options button click', () => {
    const onContextMenu = vi.fn()

    render(<PluginCard addon={installedAddon} isInstalled={true} onContextMenu={onContextMenu} />)

    const card = screen.getByRole('listitem')
    fireEvent.contextMenu(card)
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), installedAddon, true)

    const moreBtn = screen.getByTitle('More options')
    expect(moreBtn).toBeInTheDocument()
    fireEvent.click(moreBtn)
    expect(onContextMenu).toHaveBeenCalledTimes(2)
  })

  it('renders blocked reason when installed plugin is not runnable', () => {
    const blockedAddon = {
      ...installedAddon,
      runnable: false,
      blocked_reason: 'Requires Python execution which is disabled',
    }

    render(<PluginCard addon={blockedAddon} isInstalled={true} />)

    expect(screen.getByText('Requires Python execution which is disabled')).toBeInTheDocument()
  })

  it('disables buttons when busy is true', () => {
    const { rerender } = render(
      <PluginCard addon={installedAddon} isInstalled={true} busy={true} onUpdate={vi.fn()} />
    )

    const updateBtn = screen.getByRole('button', { name: /update/i })
    expect(updateBtn).toBeDisabled()

    rerender(
      <PluginCard addon={availableAddon} isInstalled={false} busy={true} onInstall={vi.fn()} />
    )
    const installBtn = screen.getByRole('button', { name: /install/i })
    expect(installBtn).toBeDisabled()
  })

  it('handles missing callback handlers gracefully without throwing', () => {
    render(<PluginCard addon={installedAddon} isInstalled={true} />)

    const moreBtn = screen.getByTitle('More options')
    expect(() => fireEvent.click(moreBtn)).not.toThrow()

    const updateBtn = screen.getByRole('button', { name: /update/i })
    expect(() => fireEvent.click(updateBtn)).not.toThrow()

    const checkbox = screen.getByRole('checkbox')
    expect(() => fireEvent.click(checkbox)).not.toThrow()

    const removeBtn = screen.getByRole('button', { name: 'Remove' })
    expect(() => fireEvent.click(removeBtn)).not.toThrow()
  })
})

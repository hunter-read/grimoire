import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddonInstallDialog from './AddonInstallDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => (opts?.name ? `${k}:${opts.name}` : k) }),
}))

const ADDON = {
  id: 'drivethru',
  name: 'DriveThruRPG',
  requires_script: true,
  script_sha256: 'a'.repeat(64),
}

describe('AddonInstallDialog', () => {
  it('warns that the add-on runs code', () => {
    render(<AddonInstallDialog addon={ADDON} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('addons.scriptWarning')).toBeInTheDocument()
  })

  it('shows the script checksum so it can be verified', () => {
    render(<AddonInstallDialog addon={ADDON} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(`sha256: ${'a'.repeat(64)}`)).toBeInTheDocument()
  })

  it('keeps install disabled until the warning is acknowledged', async () => {
    // Consent has to be deliberate — one click should not be enough.
    render(<AddonInstallDialog addon={ADDON} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^addons.install$/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /^addons.install$/i })).toBeEnabled()
  })

  it('confirms only after acknowledgement', async () => {
    const onConfirm = vi.fn()
    render(<AddonInstallDialog addon={ADDON} onConfirm={onConfirm} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /^addons.install$/i }))
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^addons.install$/i }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('cancels without installing', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<AddonInstallDialog addon={ADDON} onConfirm={onConfirm} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /common.cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<AddonInstallDialog addon={ADDON} onConfirm={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('omits the checksum line when the index did not supply one', () => {
    render(
      <AddonInstallDialog
        addon={{ ...ADDON, script_sha256: '' }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText(/sha256:/)).toBeNull()
  })
})

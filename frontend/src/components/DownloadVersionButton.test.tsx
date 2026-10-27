import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DownloadVersionButton from './DownloadVersionButton'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: (p) => `http://localhost/api${p}`,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => {
      if (k === 'common.download') return 'Download'
      if (k === 'variants.mainVersion') return 'Main version'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

describe('DownloadVersionButton', () => {
  it('is a plain link when the item has no other versions', () => {
    render(<DownloadVersionButton type="maps" id="m1" item={{ id: 'm1', variants: [] }} />)
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      'http://localhost/api/maps/m1/file'
    )
  })

  it('hides the text label when compact', () => {
    render(<DownloadVersionButton type="maps" id="m1" item={{ id: 'm1', variants: [] }} compact />)
    expect(screen.queryByText('Download')).not.toBeInTheDocument()
  })

  it('offers every version once opened', async () => {
    render(
      <DownloadVersionButton
        type="maps"
        id="m1"
        item={{
          id: 'm1',
          variant_main_id: 'm1',
          variants: [{ id: 'm2', kind: 'gridless', label: '' }],
        }}
      />
    )
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: 'Main version' })).toHaveAttribute(
      'href',
      'http://localhost/api/maps/m1/file'
    )
    expect(screen.getByRole('menuitem', { name: 'gridless' })).toHaveAttribute(
      'href',
      'http://localhost/api/maps/m2/file'
    )
  })

  it('resolves the family from a variant, not just the main entry', async () => {
    render(
      <DownloadVersionButton
        type="maps"
        id="m2"
        item={{
          id: 'm2',
          variant_main_id: 'm1',
          variants: [{ id: 'm2', kind: 'gridless', label: '' }],
        }}
      />
    )
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: 'Main version' })).toHaveAttribute(
      'href',
      'http://localhost/api/maps/m1/file'
    )
  })

  it('closes on Escape', async () => {
    render(
      <DownloadVersionButton
        type="maps"
        id="m1"
        item={{ id: 'm1', variant_main_id: 'm1', variants: [{ id: 'm2', kind: 'other' }] }}
      />
    )
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  describe('extra download entries', () => {
    const uvtt = [
      {
        key: 'uvtt',
        label: 'Download as Universal VTT',
        sublabel: 'map.uvtt',
        href: 'http://localhost/api/maps/m1/export.uvtt',
      },
    ]

    it('opens a menu even when the item has no other versions', async () => {
      render(
        <DownloadVersionButton
          type="maps"
          id="m1"
          item={{ id: 'm1', variants: [] }}
          extraItems={uvtt}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /Download/ }))
      expect(screen.getByRole('menuitem', { name: /Download as Universal VTT/ })).toHaveAttribute(
        'href',
        'http://localhost/api/maps/m1/export.uvtt'
      )
    })

    it('lists the extra entry alongside the versions', async () => {
      render(
        <DownloadVersionButton
          type="maps"
          id="m1"
          item={{ id: 'm1', variants: [{ id: 'm2', variant_kind: 'night' }] }}
          extraItems={uvtt}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /Download/ }))
      await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(1))
      expect(screen.getByRole('menuitem', { name: /Universal VTT/ })).toBeInTheDocument()
    })

    it('stays a plain link when no extras are given', () => {
      render(
        <DownloadVersionButton
          type="maps"
          id="m1"
          item={{ id: 'm1', variants: [] }}
          extraItems={[]}
        />
      )
      expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument()
    })
  })
})

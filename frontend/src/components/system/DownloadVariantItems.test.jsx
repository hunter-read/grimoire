import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DownloadVariantItems from './DownloadVariantItems'

const mockGet = vi.fn()
vi.mock('../../api', () => ({
  default: { get: (...a) => mockGet(...a) },
  mediaUrl: (p) => `http://localhost/api${p}`,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => {
      if (k === 'variants.downloadVersion') return 'Download version'
      if (k === 'variants.mainVersion') return 'Main version'
      if (k === 'common.loading') return 'Loading'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

const book = { id: 'b1', variant_count: 1 }

describe('DownloadVariantItems', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockGet.mockResolvedValue({
      id: 'b1',
      variant_main_id: 'b1',
      variants: [{ id: 'b2', kind: 'printer-friendly', label: '' }],
    })
  })

  it('does not fetch until expanded', () => {
    render(<DownloadVariantItems book={book} itemStyle={{}} />)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('lists a download link per version once expanded', async () => {
    render(<DownloadVariantItems book={book} itemStyle={{}} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download version' }))
    expect(await screen.findByRole('menuitem', { name: 'Main version' })).toHaveAttribute(
      'href',
      'http://localhost/api/books/b1/file'
    )
    expect(screen.getByRole('menuitem', { name: 'printer-friendly' })).toHaveAttribute(
      'href',
      'http://localhost/api/books/b2/file'
    )
  })

  it('closes the parent menu when a version is picked', async () => {
    const onPick = vi.fn()
    render(<DownloadVariantItems book={book} itemStyle={{}} onPick={onPick} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download version' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Main version' }))
    expect(onPick).toHaveBeenCalled()
  })
})

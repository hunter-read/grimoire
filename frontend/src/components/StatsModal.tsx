import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import type { Schema } from '../api'
import { formatSize } from '../lib/sidebarStats'

export interface StatsModalProps {
  stats: Schema<'StatsResponse'>
  onClose: () => void
}

const cell: CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}
const rowHead: CSSProperties = { ...cell, textAlign: 'left', fontWeight: 400 }
const colHead: CSSProperties = { ...cell, color: 'var(--text-muted)', fontWeight: 500 }
const totalCell: CSSProperties = { ...cell, fontWeight: 600, borderBottom: 'none' }
const totalHead: CSSProperties = { ...totalCell, textAlign: 'left' }
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 600, margin: '20px 0 8px' }

function StatTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <caption style={{ ...sectionTitle, textAlign: 'left', captionSide: 'top' }}>
        {caption}
      </caption>
      {children}
    </table>
  )
}

/**
 * Every library stat: systems, books and pages by game type with a total row,
 * each collection's size ending with the whole library's, and each collection's
 * items and variants.
 */
export default function StatsModal({ stats, onClose }: StatsModalProps) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const count = (value?: number | null) => (value ?? 0).toLocaleString()
  const size = (value?: number | null) => formatSize(t, value)

  const byType: [string, number | undefined, number | undefined, number | undefined][] = [
    [t('stats.ttrpg'), stats.ttrpg_systems, stats.ttrpg_books, stats.ttrpg_pages],
    [t('stats.wargaming'), stats.wargame_systems, stats.wargame_books, stats.wargame_pages],
  ]
  const sizes: [string, number | undefined][] = [
    [t('stats.ttrpgBooks'), stats.ttrpg_size_mb],
    [t('stats.wargameBooks'), stats.wargame_size_mb],
    [t('stats.maps'), stats.maps_size_mb],
    [t('stats.tokens'), stats.tokens_size_mb],
    [t('stats.models'), stats.models_size_mb],
    [t('stats.audio'), stats.audio_size_mb],
  ]
  const collections: [string, number | undefined, number | undefined][] = [
    [t('stats.books'), stats.books, stats.book_variants],
    [t('stats.maps'), stats.maps, stats.map_variants],
    [t('stats.tokens'), stats.tokens, stats.token_variants],
    [t('stats.models'), stats.models, stats.model_variants],
    [t('stats.audio'), stats.audio, stats.audio_variants],
  ]

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 560,
          maxWidth: '92vw',
          maxHeight: 'min(840px, 86vh)',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 id="stats-modal-title" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {t('stats.allTitle')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <LuX size={18} />
          </button>
        </div>

        <StatTable caption={t('stats.byGameType')}>
          <thead>
            <tr>
              <td style={colHead} />
              <th scope="col" style={colHead}>
                {t('stats.systems')}
              </th>
              <th scope="col" style={colHead}>
                {t('stats.books')}
              </th>
              <th scope="col" style={colHead}>
                {t('stats.pages')}
              </th>
            </tr>
          </thead>
          <tbody>
            {byType.map(([label, systems, books, pages]) => (
              <tr key={label}>
                <th scope="row" style={rowHead}>
                  {label}
                </th>
                <td style={cell}>{count(systems)}</td>
                <td style={cell}>{count(books)}</td>
                <td style={cell}>{count(pages)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" style={totalHead}>
                {t('stats.total')}
              </th>
              <td style={totalCell}>{count(stats.game_systems)}</td>
              <td style={totalCell}>{count(stats.books)}</td>
              <td style={totalCell}>{count(stats.total_pages)}</td>
            </tr>
          </tfoot>
        </StatTable>

        <StatTable caption={t('stats.sizeTitle')}>
          <tbody>
            {sizes.map(([label, value]) => (
              <tr key={label}>
                <th scope="row" style={rowHead}>
                  {label}
                </th>
                <td style={cell}>{size(value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" style={totalHead}>
                {t('stats.librarySize')}
              </th>
              <td style={totalCell}>{size(stats.library_size_mb)}</td>
            </tr>
          </tfoot>
        </StatTable>

        {/* Items leave variants out, as the library does - a gridless cut is
            the same map - so the variants are counted beside them. */}
        <StatTable caption={t('stats.collectionsTitle')}>
          <thead>
            <tr>
              <td style={colHead} />
              <th scope="col" style={colHead}>
                {t('stats.items')}
              </th>
              <th scope="col" style={colHead}>
                {t('stats.variants')}
              </th>
              <th scope="col" style={colHead}>
                {t('stats.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {collections.map(([label, items, variantCount]) => (
              <tr key={label}>
                <th scope="row" style={rowHead}>
                  {label}
                </th>
                <td style={cell}>{count(items)}</td>
                <td style={cell}>{count(variantCount)}</td>
                <td style={{ ...cell, fontWeight: 600 }}>
                  {count((items ?? 0) + (variantCount ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </StatTable>
        <p
          style={{
            fontSize: 13,
            margin: '12px 0 0',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{t('stats.indexedBooks')}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count(stats.indexed_books)}</span>
        </p>
      </div>
    </div>,
    document.body
  )
}

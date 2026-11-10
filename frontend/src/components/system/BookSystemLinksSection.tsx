import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LuLink2, LuX } from 'react-icons/lu'

import api, { bookLinks } from '../../api'
import type { Schema } from '../../api'
import { systemPath } from '../../utils/armory'
import { systemDisplayName } from '../../utils/systemDisplayName'

type LinkedSystem = Schema<'LinkedSystemRef'>
type SystemSummary = Schema<'SystemSummary'>

/**
 * The other systems a book appears in, from the book editor (issue #446).
 *
 * A link is the library's symlink: the book stays in its own folder, one file
 * and one row, and also stands on each linked system's shelf, with its category,
 * tags and access level read from that one row. Links apply at once through
 * their own endpoints, like the cover and versions, rather than waiting on Save.
 */
export interface BookSystemLinksSectionProps {
  book: { id: string; game_system_id?: string | null; game_type?: string | null }
  /** After a link is added or removed, given the book's links as they now stand. */
  onChanged?: (links: LinkedSystem[]) => void
}

export default function BookSystemLinksSection({ book, onChanged }: BookSystemLinksSectionProps) {
  const { t } = useTranslation()
  const [links, setLinks] = useState<LinkedSystem[] | null>(null)
  const [systems, setSystems] = useState<SystemSummary[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    bookLinks
      .list(book.id)
      .then((rows) => current && setLinks(rows))
      .catch(() => current && setLinks([]))
    return () => {
      current = false
    }
  }, [book.id])

  // The systems to offer are only fetched once someone asks to add a link.
  useEffect(() => {
    if (!picking || systems) return undefined
    let current = true
    const gameType = book.game_type || 'ttrpg'
    api
      .get(`/systems?include_children=true&game_type=${gameType}`)
      .then((rows) => current && setSystems(rows as SystemSummary[]))
      .catch(() => current && setSystems([]))
    return () => {
      current = false
    }
  }, [picking, systems, book.game_type])

  const run = async (fn: () => Promise<LinkedSystem[]>) => {
    setBusy(true)
    setError('')
    try {
      const next = await fn()
      setLinks(next)
      onChanged?.(next)
      return true
    } catch (e) {
      setError((e as { message?: string } | null)?.message || t('common.error'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!choice) return
    if (await run(() => bookLinks.add(book.id, choice))) {
      setChoice('')
      setPicking(false)
    }
  }

  const linkedIds = new Set((links || []).map((s) => s.id))
  const options = (systems || [])
    .filter((s) => s.id !== book.game_system_id && !linkedIds.has(s.id))
    .map((s) => ({ id: s.id, label: systemDisplayName(s) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const btnStyle: CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  if (links === null) return null

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        <LuLink2 size={14} aria-hidden="true" />
        {t('bookLinks.heading')}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>
        {t('bookLinks.hint')}
      </p>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>
          {error}
        </div>
      )}

      {links.length > 0 ? (
        <ul
          role="list"
          className="card-list"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 8px' }}
        >
          {links.map((system) => {
            const name = systemDisplayName(system)
            return (
              <li
                key={system.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  padding: '2px 4px 2px 8px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                }}
              >
                <Link to={systemPath(system)}>{name}</Link>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('bookLinks.remove', { name })}
                  title={t('bookLinks.remove', { name })}
                  onClick={() => void run(() => bookLinks.remove(book.id, system.id))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: busy ? 'default' : 'pointer',
                    display: 'flex',
                    padding: 2,
                  }}
                >
                  <LuX size={12} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          {t('bookLinks.none')}
        </p>
      )}

      {picking ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <select
            aria-label={t('bookLinks.pick')}
            value={choice}
            disabled={busy || systems === null}
            onChange={(e) => setChoice(e.target.value)}
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text)',
              border: '1px solid var(--border-control)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 12,
              maxWidth: '100%',
            }}
          >
            <option value="">{systems === null ? t('common.loading') : t('bookLinks.pick')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !choice}
            onClick={() => void add()}
            style={btnStyle}
          >
            {t('bookLinks.addButton')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPicking(false)
              setChoice('')
            }}
            style={btnStyle}
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} style={btnStyle}>
          {t('bookLinks.add')}
        </button>
      )}
    </div>
  )
}

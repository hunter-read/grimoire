import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'
import { buildGenreTree } from '../metadata/metadataUtils'

type Genre = Schema<'GenreOut'>

interface ConfirmState {
  id: string
  name: string
  count: number
}

/**
 * Admin panel to manage the genre lookup list: add tiered genres and remove
 * any (default or custom). Removing a genre that is attached to systems/books
 * requires confirmation and re-issues the delete with force=true.
 */
export default function GenreManagerSection() {
  const { t } = useTranslation()
  const [genres, setGenres] = useState<Genre[] | null>(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [error, setError] = useState('')
  // Said aloud after an add or remove, which otherwise changes the list
  // silently - and a removal takes away the button that was pressed, so focus
  // goes back to the name field once the list has reloaded.
  const [announcement, setAnnouncement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const refocusInput = useRef(false)

  const load = () => {
    api
      .get('/genres')
      .then((r) => setGenres(r.genres || []))
      .catch(() => setGenres([]))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!refocusInput.current) return
    refocusInput.current = false
    inputRef.current?.focus()
  }, [genres])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post('/genres', { name: name.trim(), parent_id: parentId || null })
      .then(() => {
        setAnnouncement(t('a11y.settings.added', { name: name.trim() }))
        setName('')
        setParentId('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (g: Pick<Genre, 'id' | 'name'>, force = false) => {
    api
      .delete(`/genres/${g.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
        setAnnouncement(t('a11y.settings.removed', { name: g.name }))
        refocusInput.current = true
        load()
      })
      .catch((e) => {
        // 409 → in use; surface a confirm modal with the usage count.
        const detail = e?.body?.detail
        if (e?.status === 409 && detail && typeof detail === 'object') {
          setConfirm({ id: g.id, name: detail.name || g.name, count: detail.usage_count || 0 })
        } else {
          setError(e?.message || t('lookupSettings.removeFailed'))
        }
      })
  }

  if (genres === null) return <Spinner size={20} />

  const tree = buildGenreTree(genres)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={t('lookupSettings.namePlaceholder')}
          aria-label={t('lookupSettings.namePlaceholder')}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label={t('lookupSettings.parentLabel')}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        >
          <option value="">{t('lookupSettings.noParent')}</option>
          {tree.map((g) => (
            <option key={g.id} value={g.id}>
              {`${'  '.repeat(g.depth)}${g.name}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'var(--gold-dim)',
            color: 'var(--bg-deep)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <LuPlus size={13} /> {t('lookupSettings.add')}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ul
        role="list"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {tree.map((g) => (
          <li
            key={g.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 8px',
              paddingLeft: 8 + g.depth * 20,
              borderRadius: 6,
              background: g.depth === 0 ? 'var(--bg-card)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text)' }}>
              {/* The connector is drawn, not read: "box drawings up and right". */}
              {g.depth > 0 && <span aria-hidden="true">└ </span>}
              {g.name}
            </span>
            <button
              type="button"
              onClick={() => remove(genres.find((x) => x.id === g.id)!)}
              aria-label={`${t('common.remove')} ${g.name}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 4,
              }}
            >
              <LuTrash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      {confirm && (
        <ConfirmModal
          title={t('lookupSettings.removeTitle', { name: confirm.name })}
          message={t('lookupSettings.inUseWarning', { name: confirm.name, count: confirm.count })}
          confirmLabel={t('lookupSettings.confirmRemove')}
          onClose={() => setConfirm(null)}
          onConfirm={() => remove({ id: confirm.id, name: confirm.name }, true)}
        />
      )}
    </div>
  )
}

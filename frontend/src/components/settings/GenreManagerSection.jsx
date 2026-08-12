import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { buildGenreTree } from '../metadata/metadataUtils'

/**
 * Admin panel to manage the genre lookup list: add tiered genres and remove
 * any (default or custom). Removing a genre that is attached to systems/books
 * requires confirmation and re-issues the delete with force=true.
 */
export default function GenreManagerSection() {
  const { t } = useTranslation()
  const [genres, setGenres] = useState(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [confirm, setConfirm] = useState(null) // { id, name, count }
  const [error, setError] = useState('')

  const load = () => {
    api
      .get('/genres')
      .then((r) => setGenres(r.genres || []))
      .catch(() => setGenres([]))
  }

  useEffect(load, [])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post('/genres', { name: name.trim(), parent_id: parentId || null })
      .then(() => {
        setName('')
        setParentId('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (g, force = false) => {
    api
      .delete(`/genres/${g.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
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
        <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tree.map((g) => (
          <div
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
              {g.depth > 0 && '└ '}
              {g.name}
            </span>
            <button
              type="button"
              onClick={() => remove(genres.find((x) => x.id === g.id))}
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
          </div>
        ))}
      </div>

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 24,
              maxWidth: 420,
            }}
          >
            <h4 style={{ fontSize: 16, marginBottom: 10 }}>
              {t('lookupSettings.removeTitle', { name: confirm.name })}
            </h4>
            <p
              style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 20 }}
            >
              {t('lookupSettings.inUseWarning', { name: confirm.name, count: confirm.count })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                }}
              >
                {t('lookupSettings.cancel')}
              </button>
              <button
                type="button"
                onClick={() => remove({ id: confirm.id, name: confirm.name }, true)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  background: 'var(--danger-fill)',
                  border: 'none',
                  color: 'var(--on-danger)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('lookupSettings.confirmRemove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

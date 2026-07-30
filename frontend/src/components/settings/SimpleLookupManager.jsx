import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

/**
 * Generic manager for a flat name-only lookup list (system families, parent
 * systems, licenses). Handles load / add / remove with the shared in-use
 * confirmation flow (409 → re-issue with force=true). The parent supplies the
 * REST endpoint and the response list key.
 *
 * Props:
 *   endpoint   – REST base path, e.g. "/parent-systems"
 *   listKey    – key in the GET response holding the array, e.g. "parent_systems"
 *   addPlaceholder – localized placeholder / aria-label for the name input
 */
export default function SimpleLookupManager({ endpoint, listKey, addPlaceholder }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    api
      .get(endpoint)
      .then((r) => setItems(r[listKey] || []))
      .catch(() => setItems([]))
  }

  useEffect(load, [endpoint, listKey])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post(endpoint, { name: name.trim() })
      .then(() => {
        setName('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (item, force = false) => {
    api
      .delete(`${endpoint}/${item.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
        load()
      })
      .catch((e) => {
        const detail = e?.body?.detail
        if (e?.status === 409 && detail && typeof detail === 'object') {
          setConfirm({
            id: item.id,
            name: detail.name || item.name,
            count: detail.usage_count || 0,
          })
        } else {
          setError(e?.message || t('lookupSettings.removeFailed'))
        }
      })
  }

  if (items === null) return <Spinner size={20} />

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={addPlaceholder || t('lookupSettings.namePlaceholder')}
          aria-label={addPlaceholder || t('lookupSettings.namePlaceholder')}
          style={{ flex: '1 1 200px', minWidth: 0 }}
        />
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

      {error && <div style={{ color: '#e07070', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('lookupSettings.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((item) => (
            <span
              key={item.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                padding: '4px 6px 4px 10px',
                borderRadius: 16,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            >
              {item.name}
              <button
                type="button"
                onClick={() => remove(item)}
                aria-label={`${t('common.remove')} ${item.name}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  padding: 2,
                }}
              >
                <LuTrash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
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
                  background: '#c0504d',
                  border: 'none',
                  color: '#fff',
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

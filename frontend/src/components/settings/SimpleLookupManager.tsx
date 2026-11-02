import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'

interface LookupItem {
  id: string
  name: string
}

interface ConfirmState {
  id: string
  name: string
  count: number
}

interface Props {
  endpoint: string
  listKey: string
  addPlaceholder?: string
}

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
export default function SimpleLookupManager({ endpoint, listKey, addPlaceholder }: Props) {
  const { t } = useTranslation()
  const [items, setItems] = useState<LookupItem[] | null>(null)
  const [name, setName] = useState('')
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
      .get(endpoint)
      .then((r) => setItems((r as Record<string, LookupItem[]>)[listKey] || []))
      .catch(() => setItems([]))
  }

  useEffect(load, [endpoint, listKey])

  useEffect(() => {
    if (!refocusInput.current) return
    refocusInput.current = false
    inputRef.current?.focus()
  }, [items])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post(endpoint, { name: name.trim() })
      .then(() => {
        setAnnouncement(t('a11y.settings.added', { name: name.trim() }))
        setName('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (item: LookupItem, force = false) => {
    api
      .delete(`${endpoint}/${item.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
        setAnnouncement(t('a11y.settings.removed', { name: item.name }))
        refocusInput.current = true
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
          ref={inputRef}
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

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('lookupSettings.empty')}</p>
      ) : (
        <ul
          role="list"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {items.map((item) => (
            <li
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
            </li>
          ))}
        </ul>
      )}

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

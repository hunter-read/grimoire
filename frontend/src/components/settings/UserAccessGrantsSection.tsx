import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2 } from 'react-icons/lu'
import type { CSSProperties } from 'react'
import api from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import { ghostBtnStyle } from './settingsButtons'
import GrantAdder from './GrantAdder'

// The admin lookups carry the access level the picker filters on; the
// schema's summary models do not list it.
type GrantSystem = Schema<'SystemSummary'> & { access_level?: string | null }
type GrantBook = Schema<'BookListItem'> & { effective_access_level?: string | null }

interface Props {
  userId: string
  userRole?: string | null
}

// Per-user access grants (issue #258). Lets an admin hand one GM access to a
// restricted system or book without lowering the restriction for anyone else.
//
// Only rendered for GMs: admins already see everything (a grant would be a
// no-op) and players are exactly who the restrictions exclude, so the backend
// rejects grants for both. Showing the panel with an explanation, rather than
// hiding it, answers the obvious "why can't I grant this player access?".
export default function UserAccessGrantsSection({ userId, userRole }: Props) {
  const { t } = useTranslation()
  const [grants, setGrants] = useState<Schema<'AccessGrantOut'>[] | null>(null)
  const [systems, setSystems] = useState<GrantSystem[]>([])
  const [books, setBooks] = useState<GrantBook[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  const isGm = userRole === 'gm'

  const load = useCallback(() => {
    if (!isGm) {
      setGrants([])
      return
    }
    api
      .get(`/users/${userId}/access-grants`)
      .then((rows) => setGrants(rows as Schema<'AccessGrantOut'>[]))
      .catch(() => setGrants([]))
  }, [userId, isGm])

  useEffect(load, [load])

  useEffect(() => {
    if (!isGm) return
    // Admin-scoped lookups, so these lists include the restricted entries that
    // are the only ones worth granting.
    api
      .get('/systems')
      .then((rows) => setSystems((rows as GrantSystem[]).filter((s) => s.access_level)))
      .catch(() => setSystems([]))
    api
      .get('/books?limit=500')
      .then((d) =>
        setBooks(((d.books || []) as GrantBook[]).filter((b) => b.effective_access_level))
      )
      .catch(() => setBooks([]))
  }, [isGm])

  const addGrant = async (scopeType: string, scopeId: string, level: string) => {
    if (!scopeId) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/users/${userId}/access-grants`, {
        scope_type: scopeType,
        scope_id: scopeId,
        level,
      })
      load()
    } catch (e) {
      setError((e as Error | null)?.message || t('a11y.settingsAccess.grantAddFailed'))
    } finally {
      setBusy(false)
    }
  }

  const removeGrant = async (grantId: string, name: string) => {
    setBusy(true)
    try {
      await api.delete(`/users/${userId}/access-grants/${grantId}`)
      setStatus(t('a11y.settingsAccess.grantRemoved', { name }))
      load()
      // The revoked row took focus with it; the heading is the nearest place
      // that is sure to still be there.
      headingRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  if (!isGm) {
    return (
      <div>
        <h3 style={titleStyle}>{t('access.grants.title')}</h3>
        <p style={noteStyle}>{t('access.grants.gmOnly')}</p>
      </div>
    )
  }

  if (grants === null) return <Spinner size={16} />

  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} className="focus-target" style={titleStyle}>
        {t('access.grants.title')}
      </h3>
      <p style={noteStyle}>{t('access.grants.description')}</p>
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {grants.length === 0 ? (
        <p style={{ ...noteStyle, fontStyle: 'italic' }}>{t('access.grants.empty')}</p>
      ) : (
        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
          {grants.map((g) => (
            <li
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--text)' }}>
                {g.scope_name || t('access.grants.deletedScope')}{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  ({g.scope_type} · {t(`access.levels.${g.level}`)})
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeGrant(g.id, g.scope_name || t('access.grants.deletedScope'))}
                disabled={busy}
                style={ghostBtnStyle}
                title={t('access.grants.remove')}
                aria-label={t('a11y.settingsAccess.revokeGrant', {
                  name: g.scope_name || t('access.grants.deletedScope'),
                })}
              >
                <LuTrash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <GrantAdder
        label={t('access.grants.addSystem')}
        options={systems.map((s) => ({ id: s.id, name: s.name }))}
        onAdd={(id, level) => addGrant('system', id, level)}
        disabled={busy}
      />
      <GrantAdder
        label={t('access.grants.addBook')}
        options={books.map((b) => ({ id: b.id, name: b.title }))}
        onAdd={(id, level) => addGrant('book', id, level)}
        disabled={busy}
      />

      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

const titleStyle: CSSProperties = {
  // A heading in the body's type, not the global Cinzel/gold.
  fontFamily: 'inherit',
  letterSpacing: 'normal',
  marginTop: 0,
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const noteStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text-dim)',
  lineHeight: 1.5,
  marginBottom: 10,
}

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2 } from 'react-icons/lu'
import api from '../../api'
import { ACCESS_ADMIN, ACCESS_GM } from '../../accessLevels'
import Spinner from '../Spinner'
import { ghostBtnStyle } from './settingsButtons'
import GrantAdder from './GrantAdder'

// Per-user access grants (issue #258). Lets an admin hand one GM access to a
// restricted system or book without lowering the restriction for anyone else.
//
// Only rendered for GMs: admins already see everything (a grant would be a
// no-op) and players are exactly who the restrictions exclude, so the backend
// rejects grants for both. Showing the panel with an explanation, rather than
// hiding it, answers the obvious "why can't I grant this player access?".
export default function UserAccessGrantsSection({ userId, userRole }) {
  const { t } = useTranslation()
  const [grants, setGrants] = useState(null)
  const [systems, setSystems] = useState([])
  const [books, setBooks] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isGm = userRole === 'gm'

  const load = useCallback(() => {
    if (!isGm) {
      setGrants([])
      return
    }
    api
      .get(`/users/${userId}/access-grants`)
      .then(setGrants)
      .catch(() => setGrants([]))
  }, [userId, isGm])

  useEffect(load, [load])

  useEffect(() => {
    if (!isGm) return
    // Admin-scoped lookups, so these lists include the restricted entries that
    // are the only ones worth granting.
    api
      .get('/systems')
      .then((rows) => setSystems(rows.filter((s) => s.access_level)))
      .catch(() => setSystems([]))
    api
      .get('/books?limit=500')
      .then((d) => setBooks((d.books || []).filter((b) => b.effective_access_level)))
      .catch(() => setBooks([]))
  }, [isGm])

  const addGrant = async (scopeType, scopeId, level) => {
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
      setError(e?.message || 'Could not add the grant.')
    } finally {
      setBusy(false)
    }
  }

  const removeGrant = async (grantId) => {
    setBusy(true)
    try {
      await api.delete(`/users/${userId}/access-grants/${grantId}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!isGm) {
    return (
      <div>
        <div style={titleStyle}>{t('access.grants.title')}</div>
        <p style={noteStyle}>{t('access.grants.gmOnly')}</p>
      </div>
    )
  }

  if (grants === null) return <Spinner size={16} />

  return (
    <div>
      <div style={titleStyle}>{t('access.grants.title')}</div>
      <p style={noteStyle}>{t('access.grants.description')}</p>

      {grants.length === 0 ? (
        <p style={{ ...noteStyle, fontStyle: 'italic' }}>{t('access.grants.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
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
                onClick={() => removeGrant(g.id)}
                disabled={busy}
                style={ghostBtnStyle}
                aria-label={t('access.grants.remove')}
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

      {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}
    </div>
  )
}

const titleStyle = {
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const noteStyle = {
  fontSize: 13,
  color: 'var(--text-dim)',
  lineHeight: 1.5,
  marginBottom: 10,
}
const selectStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  flex: 1,
  minWidth: 0,
}

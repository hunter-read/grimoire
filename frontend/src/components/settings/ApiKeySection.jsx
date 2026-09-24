import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus } from 'react-icons/lu'
import { apiKeys as apiKeysApi } from '../../api'
import Spinner from '../Spinner'
import ApiKeyDialog from './ApiKeyDialog'
import ApiKeyReveal from './ApiKeyReveal'
import ApiKeyRow from './ApiKeyRow'
import ConfirmModal from './ConfirmModal'

// Personal API keys (issue #489): named keys that act as their owner, each with
// its own level per area of the API, shown once at creation and stored hashed.
// `scope="all"` is the admin view of every user's keys, where the only action is
// revoking one - nobody can mint a secret for someone else's key.
export default function ApiKeySection({ scope = 'mine' }) {
  const everyone = scope === 'all'
  const { t } = useTranslation()
  const [keys, setKeys] = useState([])
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // null | { mode: 'create' } | { mode: 'edit', key }
  const [dialog, setDialog] = useState(null)
  // null | { action: 'regenerate' | 'revoke', key }
  const [confirm, setConfirm] = useState(null)
  // null | { apiKey, secret } - the one-time reveal.
  const [revealed, setRevealed] = useState(null)

  const load = useCallback(async () => {
    try {
      const [list, perms] = await Promise.all([apiKeysApi.list(everyone), apiKeysApi.permissions()])
      setKeys(list)
      setPermissions(perms)
      setError(null)
    } catch (err) {
      setError(err?.message || t('appSettings.apiKeys.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t, everyone])

  useEffect(() => {
    load()
  }, [load])

  const save = async (payload) => {
    if (dialog.mode === 'create') {
      const created = await apiKeysApi.create(payload)
      setKeys((prev) => [created.api_key, ...prev])
      setRevealed({ apiKey: created.api_key, secret: created.key })
    } else {
      const updated = await apiKeysApi.update(dialog.key.id, payload)
      setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)))
    }
    setDialog(null)
  }

  const runConfirmed = async () => {
    const { action, key } = confirm
    setConfirm(null)
    setError(null)
    try {
      if (action === 'revoke') {
        await apiKeysApi.revoke(key.id)
        setKeys((prev) => prev.filter((k) => k.id !== key.id))
      } else {
        const regenerated = await apiKeysApi.regenerate(key.id)
        setKeys((prev) => prev.map((k) => (k.id === key.id ? regenerated.api_key : k)))
        setRevealed({ apiKey: regenerated.api_key, secret: regenerated.key })
      }
    } catch (err) {
      setError(err?.message || t('appSettings.apiKeys.actionFailed'))
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: everyone ? 18 : 15, fontWeight: 600, marginBottom: 6 }}>
        {everyone ? t('appSettings.apiKeys.allTitle') : t('appSettings.apiKeys.title')}
      </h3>
      {everyone ? (
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('appSettings.apiKeys.allDescription')}
        </p>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('appSettings.apiKeys.description')}{' '}
          <code
            style={{
              fontSize: 12,
              background: 'var(--bg-card)',
              padding: '1px 5px',
              borderRadius: 4,
            }}
          >
            X-API-Key
          </code>{' '}
          {t('appSettings.apiKeys.descriptionSuffix')}
        </p>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <Spinner size={20} />
      ) : (
        <>
          {keys.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>
              {t('appSettings.apiKeys.empty')}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
              {keys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  permissions={permissions}
                  showOwner={everyone}
                  onEdit={(k) => setDialog({ mode: 'edit', key: k })}
                  onRegenerate={(k) => setConfirm({ action: 'regenerate', key: k })}
                  onRevoke={(k) => setConfirm({ action: 'revoke', key: k })}
                />
              ))}
            </div>
          )}
          {!everyone && (
            <button
              type="button"
              onClick={() => setDialog({ mode: 'create' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                padding: '8px 18px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              <LuPlus size={14} /> {t('appSettings.apiKeys.create')}
            </button>
          )}
        </>
      )}

      {dialog && (
        <ApiKeyDialog
          apiKey={dialog.mode === 'edit' ? dialog.key : null}
          permissions={permissions}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={t(`appSettings.apiKeys.confirm.${confirm.action}Title`, {
            name: confirm.key.name,
          })}
          message={t(`appSettings.apiKeys.confirm.${confirm.action}Message`)}
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
      {revealed && (
        <ApiKeyReveal
          apiKey={revealed.apiKey}
          secret={revealed.secret}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  )
}

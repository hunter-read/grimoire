import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settings as settingsApi } from '../../api'
import PermissionToggle from './PermissionToggle'

/**
 * Which roles may create share links by default (issue #541). Admins always
 * may; GMs by default; players only once turned on here. A per-user override
 * in the table below wins over all of this either way.
 */
export default function ShareLinkRolesSection({ onChanged }) {
  const { t } = useTranslation()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    settingsApi
      .get()
      .then(setState)
      .catch(() => setState(null))
  }, [])

  if (!state) return null

  const toggle = async (role) => {
    const key = `share_links_role_${role}`
    setError('')
    try {
      setState(await settingsApi.patch({ [key]: !state[key] }))
      // Every user following that role just changed; let the table re-read them.
      onChanged?.()
    } catch (err) {
      setError(err.message || t('users.shareLinks.rolesFailed'))
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 16,
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {t('users.shareLinks.rolesTitle')}
      </div>
      {state.share_links_enabled === false ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('users.shareLinks.disabled')}
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 10px' }}>
            {t('users.shareLinks.rolesHint')}
          </p>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <PermissionToggle
              id="share-role-admin"
              label={t('users.roles.admin')}
              title={t('users.shareLinks.adminAlways')}
              checked
              disabled
              accent="var(--gold)"
              onChange={() => {}}
            />
            <PermissionToggle
              id="share-role-gm"
              label={t('users.roles.gm')}
              checked={Boolean(state.share_links_role_gm)}
              accent="var(--gold)"
              onChange={() => toggle('gm')}
            />
            <PermissionToggle
              id="share-role-player"
              label={t('users.roles.player')}
              checked={Boolean(state.share_links_role_player)}
              accent="var(--gold)"
              onChange={() => toggle('player')}
            />
          </div>
          {error && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '8px 0 0' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settings as settingsApi, type Schema } from '../../api'
import PermissionToggle from './PermissionToggle'

type Settings = Schema<'SettingsResponse'>
type Role = 'gm' | 'player'

interface ShareLinkRolesSectionProps {
  /** Called after a role default changes, so a user list can re-read who may share. */
  onChanged?: () => void
}

/**
 * Which roles may create share links by default (issue #541). Admins always
 * may; GMs by default; players only once turned on here. A per-user override
 * on the person's own account wins over all of this either way.
 */
export default function ShareLinkRolesSection({ onChanged }: ShareLinkRolesSectionProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    settingsApi
      .get()
      .then(setState)
      .catch(() => setState(null))
  }, [])

  if (!state) return null

  const toggle = async (role: Role) => {
    const key = `share_links_role_${role}` as const
    setError('')
    try {
      setState(await settingsApi.patch({ [key]: !state[key] }))
      // Every user following that role just changed; let a user list re-read them.
      onChanged?.()
    } catch (err) {
      setError((err as Error | null)?.message || t('users.shareLinks.rolesFailed'))
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>{t('settings.entries.shareLinkRoles')}</h3>
      {state.share_links_enabled === false ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          {t('users.shareLinks.disabled')}
        </p>
      ) : (
        <>
          <p
            style={{
              fontSize: 14,
              color: 'var(--text-dim)',
              marginBottom: 16,
              lineHeight: 1.6,
              maxWidth: '70ch',
            }}
          >
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
              title={undefined}
              disabled={false}
              checked={Boolean(state.share_links_role_gm)}
              accent="var(--gold)"
              onChange={() => toggle('gm')}
            />
            <PermissionToggle
              id="share-role-player"
              label={t('users.roles.player')}
              title={undefined}
              disabled={false}
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

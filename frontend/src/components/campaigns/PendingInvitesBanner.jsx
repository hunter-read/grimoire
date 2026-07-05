import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuMailOpen, LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import { useAuth } from '../../context/AuthContext'

// Per-session dismissal: sessionStorage survives reloads within a tab but is
// cleared when the window/tab is closed, so the banner reappears next session.
const DISMISS_KEY = 'grimoire:invites_dismissed'

/**
 * App-level banner surfacing the current user's pending campaign invitations.
 * Lets the user accept or decline inline, jump to the campaigns page, or dismiss
 * the banner for the current browser session.
 */
export default function PendingInvitesBanner() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [invites, setInvites] = useState([])
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === 'true')
  const [busy, setBusy] = useState(false)

  const load = () => {
    campaigns
      .invites()
      .then(setInvites)
      .catch(() => setInvites([]))
  }

  useEffect(() => {
    load()
    window.addEventListener('grimoire:campaigns-changed', load)
    return () => window.removeEventListener('grimoire:campaigns-changed', load)
  }, [])

  const respond = async (invite, status) => {
    if (busy) return
    setBusy(true)
    try {
      await campaigns.updateMember(invite.campaign_id, user.id, status)
      setInvites((cur) => cur.filter((i) => i.campaign_id !== invite.campaign_id))
      window.dispatchEvent(new CustomEvent('grimoire:campaigns-changed'))
    } catch {
      // Leave the invite in place so the user can retry.
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  // Guests are scoped to a single campaign and never receive invitations.
  if (dismissed || invites.length === 0 || user?.role === 'guest') return null

  const single = invites.length === 1 ? invites[0] : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        borderLeft: '3px solid var(--gold)',
      }}
    >
      <LuMailOpen size={17} color="var(--gold)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
        {single ? (
          <span>
            {t('campaigns.inviteBanner.single', {
              gm: single.owner_display_name || t('campaigns.unknownGm'),
              name: single.name,
            })}
          </span>
        ) : (
          <span>{t('campaigns.inviteBanner.multi', { count: invites.length })}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
        {single ? (
          <>
            <button
              disabled={busy}
              onClick={() => respond(single, 'accepted')}
              style={{
                padding: '6px 14px',
                borderRadius: 7,
                background: 'var(--gold-dim)',
                border: 'none',
                color: 'var(--bg-deep)',
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {t('campaigns.accept')}
            </button>
            <button
              disabled={busy}
              onClick={() => respond(single, 'declined')}
              style={{
                padding: '6px 14px',
                borderRadius: 7,
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontSize: 13,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {t('campaigns.decline')}
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate('/campaigns')}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('campaigns.inviteBanner.view')}
          </button>
        )}
        <button
          onClick={dismiss}
          title={t('campaigns.inviteBanner.dismiss')}
          aria-label={t('campaigns.inviteBanner.dismiss')}
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <LuX size={16} />
        </button>
      </div>
    </div>
  )
}

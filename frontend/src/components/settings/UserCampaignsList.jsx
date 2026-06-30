import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuScroll } from 'react-icons/lu'
import { campaigns } from '../../api'

/**
 * Inline, always-loaded list of the campaigns a user owns/belongs to.
 * Used inside the expanded user editor (no toggle — shown immediately).
 */
export default function UserCampaignsList({ userId }) {
  const { t } = useTranslation()
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setErr('')
    campaigns
      .adminListByUser(userId)
      .then((data) => {
        if (active) setList(data)
      })
      .catch((e) => {
        if (active) setErr(e?.message || t('users.campaigns.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId, t])

  if (loading) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('common.loading')}</p>
    )
  }
  if (err) {
    return <p style={{ fontSize: 13, color: 'var(--red)', margin: 0 }}>{err}</p>
  }
  if (!list || list.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        {t('users.campaigns.none')}
      </p>
    )
  }

  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {list.map((c) => (
        <li
          key={c.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '8px 10px',
            background: 'var(--bg-card)',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LuScroll size={13} color="var(--gold)" style={{ flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {c.name}
            </span>
            {c.is_gm_campaign && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(200,160,80,0.15)',
                  color: 'var(--gold)',
                  border: '1px solid rgba(200,160,80,0.3)',
                  flexShrink: 0,
                }}
              >
                GM
              </span>
            )}
            {c.system_name && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                {c.system_name}
              </span>
            )}
          </div>
          {c.description && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {c.description}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

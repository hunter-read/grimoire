import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuScroll, LuChevronDown, LuChevronUp } from 'react-icons/lu'
import { campaigns } from '../../api'

export default function UserCampaignsPanel({ userId }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await campaigns.adminListByUser(userId)
      setList(data)
    } catch (e) {
      setErr(e?.message || t('users.campaigns.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    if (!expanded && list === null) load()
    setExpanded((v) => !v)
  }

  return (
    <>
      <button
        onClick={handleToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          fontSize: 12,
          cursor: 'pointer',
        }}
        aria-expanded={expanded}
        aria-label={t('users.campaigns.toggleLabel')}
      >
        <LuScroll size={12} />
        {t('users.campaigns.toggleLabel')}
        {expanded ? <LuChevronUp size={12} /> : <LuChevronDown size={12} />}
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          {loading && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('common.loading')}</p>
          )}
          {err && <p style={{ fontSize: 13, color: 'var(--red)' }}>{err}</p>}
          {!loading && list !== null && list.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('users.campaigns.none')}</p>
          )}
          {!loading && list && list.length > 0 && (
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
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          flexShrink: 0,
                        }}
                      >
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
          )}
        </div>
      )}
    </>
  )
}

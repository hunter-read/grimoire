import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuScroll, LuCheck, LuChevronDown, LuPlus } from 'react-icons/lu'
import { campaigns } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useUISettings } from '../../context/UISettingsContext'

export default function AddToCampaignButton({ resourceType, resourceId, style }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { hide_campaigns } = useUISettings()
  if (hide_campaigns) return null
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [added, setAdded] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const btnRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  // Load campaigns and figure out which already contain this resource
  useEffect(() => {
    if (!open) return
    setLoading(true)
    campaigns
      .list()
      .then(async (all) => {
        // Only campaigns the user owns
        const owned = all.filter((c) => c.owner_id === user?.id)
        setList(owned)

        // For each campaign, check resources to see if this is already linked
        const alreadyAdded = new Set()
        await Promise.all(
          owned.map((c) =>
            campaigns
              .listResources(c.id)
              .then((resources) => {
                const found = resources.some(
                  (r) => r.resource_type === resourceType && r.resource_id === resourceId
                )
                if (found) alreadyAdded.add(c.id)
              })
              .catch(() => {})
          )
        )
        setAdded(alreadyAdded)
      })
      .catch(() => setList([]))
      .finally(() => setLoading(false))
  }, [open, resourceType, resourceId, user?.id])

  const openMenu = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }

  const handleAdd = async (campaignId) => {
    if (added.has(campaignId)) return
    try {
      await campaigns.addResource(campaignId, {
        resource_type: resourceType,
        resource_id: resourceId,
        shared: false,
      })
      setAdded((prev) => new Set([...prev, campaignId]))
    } catch (err) {
      if (err.status === 409) {
        setAdded((prev) => new Set([...prev, campaignId]))
      } else {
        alert(err.message)
      }
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        title={t('resources.addToCampaign')}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: 14,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          ...style,
        }}
      >
        <LuScroll size={13} />
        {t('resources.addToCampaign')}
        <LuChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 9999,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              minWidth: 220,
              maxWidth: 300,
              padding: 6,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                padding: '4px 8px 8px',
              }}
            >
              {t('resources.addToCampaign')}
            </div>

            {loading && (
              <div style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('common.loading')}
              </div>
            )}

            {!loading && list?.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('resources.noCampaigns')}
              </div>
            )}

            {!loading &&
              list?.map((c) => {
                const isAdded = added.has(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => handleAdd(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      width: '100%',
                      background: isAdded ? 'var(--bg-deep)' : 'transparent',
                      border: 'none',
                      borderRadius: 7,
                      cursor: isAdded ? 'default' : 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      if (!isAdded) e.currentTarget.style.background = 'var(--bg-card)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isAdded) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        flexShrink: 0,
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isAdded ? 'var(--gold)' : 'var(--text-muted)',
                      }}
                    >
                      {isAdded ? <LuCheck size={13} /> : <LuPlus size={13} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: isAdded ? 'var(--text-muted)' : 'var(--text)',
                        }}
                      >
                        {c.name}
                      </div>
                      {c.gm_title && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.gm_title}</div>
                      )}
                    </div>
                    {isAdded && (
                      <span style={{ fontSize: 11, color: 'var(--gold)', flexShrink: 0 }}>
                        {t('resources.added')}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        </>
      )}
    </>
  )
}

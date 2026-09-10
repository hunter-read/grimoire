import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { campaigns as campaignsApi } from '../../../api'
import Spinner from '../../Spinner'

/**
 * Pick which character the finished token becomes the portrait for.
 *
 * Only shown when the editor was opened standalone. Arriving from a member row
 * pre-binds the target, which is the common path and skips this entirely.
 *
 * The list is built from memberships the viewer may actually edit — their own
 * row in any campaign, plus every row in campaigns they own. That mirrors the
 * server's `_assert_can_edit_member` exactly, so nothing offered here can be
 * refused on submit.
 */
export default function SetAsArtDialog({ userId, onClose, onChoose }) {
  const { t } = useTranslation()
  const [options, setOptions] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await campaignsApi.list()
        const rows = []
        // The list payload carries only light member rows, so each campaign is
        // fetched for the membership ids the art endpoint is keyed by.
        for (const summary of list?.campaigns || []) {
          const detail = await campaignsApi.get(summary.id)
          const isOwner = detail.owner_id === userId
          for (const member of detail.members || []) {
            if (!member.id) continue // the synthetic owner row has no membership
            if (!isOwner && member.user_id !== userId) continue
            rows.push({
              campaignId: detail.id,
              campaignName: detail.name,
              memberId: member.id,
              memberName: member.character_name || member.display_name || member.username,
            })
          }
        }
        if (!cancelled) setOptions(rows)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || t('tokenEditor.campaignsFailed'))
          setOptions([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, t])

  // Escape closes, handled on the panel rather than window — the same reasoning
  // as the file-manager modals: a window listener would also catch keystrokes
  // bubbling from whatever is behind this.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('tokenEditor.setAsArt')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          {t('tokenEditor.setAsArt')}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('tokenEditor.setAsArtHint')}
        </p>

        {options === null && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Spinner size={20} />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}

        {options !== null && options.length === 0 && !error && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('tokenEditor.noCharacters')}</p>
        )}

        {options !== null && options.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {options.map((option) => (
              <button
                key={option.memberId}
                type="button"
                onClick={() => onChoose(option)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{option.memberName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{option.campaignName}</div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btn}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const panel = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
}

const btn = {
  padding: '7px 14px',
  fontSize: 13,
  borderRadius: 5,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
}

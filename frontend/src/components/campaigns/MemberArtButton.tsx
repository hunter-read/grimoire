import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuImagePlus, LuUpload, LuWand } from 'react-icons/lu'

import { campaigns } from '../../api'
import LazyImg from '../LazyImg'

/**
 * A member's portrait, and the two ways to set one.
 *
 * Extracted from `MemberRow` when the token editor gained an entry point here:
 * the row was already long, and the avatar now owns a small menu rather than a
 * single hidden file input.
 *
 * `canEdit` is the caller's `isCurrentUser || canManage`, which is deliberately
 * the same predicate the server's `_assert_can_edit_member` applies — so a
 * player sees these actions on their own row and nowhere else, and nothing
 * offered here can be refused on submit.
 */
export default function MemberArtButton({
  member,
  campaignId,
  canEdit,
  isMemberOwner,
  displayLabel,
  busy,
  onUpload,
  artVersion,
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const openEditor = () => {
    setMenuOpen(false)
    navigate('/tokens/editor', {
      state: {
        campaignId,
        memberId: member.id,
        memberName: member.character_name || displayLabel,
      },
    })
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setMenuOpen(false)
    if (file) onUpload(file)
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={canEdit ? () => setMenuOpen((open) => !open) : undefined}
        title={canEdit ? t('members.setArt') : undefined}
        aria-label={canEdit ? t('members.setArt') : undefined}
        aria-expanded={canEdit ? menuOpen : undefined}
        disabled={busy}
        style={{
          position: 'relative',
          width: 34,
          height: 34,
          borderRadius: '50%',
          overflow: 'hidden',
          padding: 0,
          background: 'var(--bg-deep)',
          border: `1px solid ${isMemberOwner ? 'var(--gold-dim)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          color: isMemberOwner ? 'var(--gold)' : 'var(--text-dim)',
          cursor: canEdit ? 'pointer' : 'default',
        }}
      >
        {member.has_art && member.id ? (
          <LazyImg
            // The version stamp busts the 5-minute upload cache, so art replaced
            // just now shows immediately rather than after it expires.
            src={campaigns.memberArtUrl(campaignId, member.id, artVersion)}
            alt={member.character_name || displayLabel}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : canEdit ? (
          <LuImagePlus size={16} aria-hidden="true" />
        ) : (
          (displayLabel?.[0]?.toUpperCase() ?? '?')
        )}
      </button>

      {menuOpen && canEdit && (
        <>
          {/* A click anywhere else dismisses the menu. */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 38,
              left: 0,
              zIndex: 41,
              minWidth: 170,
              padding: 4,
              borderRadius: 6,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            }}
          >
            <button type="button" role="menuitem" onClick={openEditor} style={menuItem}>
              <LuWand size={14} aria-hidden="true" />
              {t('members.createToken')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => inputRef.current?.click()}
              style={menuItem}
            >
              <LuUpload size={14} aria-hidden="true" />
              {t('members.uploadArt')}
            </button>
          </div>
        </>
      )}

      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          data-testid="member-art-input"
          style={{ display: 'none' }}
        />
      )}
    </div>
  )
}

const menuItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  fontSize: 12,
  borderRadius: 4,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text)',
  border: 'none',
  textAlign: 'left',
}

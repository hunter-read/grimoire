import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuImagePlus, LuUpload, LuWand } from 'react-icons/lu'

import { campaigns, type Schema } from '../../api'
import LazyImg from '../LazyImg'
import useMenuKeyboard from '../../hooks/useMenuKeyboard'

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
interface MemberArtButtonProps {
  member: Schema<'CampaignMemberOut'>
  campaignId: string
  canEdit: boolean
  isMemberOwner: boolean
  displayLabel: string
  busy?: boolean
  onUpload: (file: File) => void
  artVersion?: string | number | null
}

export default function MemberArtButton({
  member,
  campaignId,
  canEdit,
  isMemberOwner,
  displayLabel,
  busy,
  onUpload,
  artVersion,
}: MemberArtButtonProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Arrow keys through the two items, Esc or Tab to close back onto the button.
  useMenuKeyboard(menuOpen, menuRef, triggerRef, () => setMenuOpen(false))

  const openEditor = () => {
    setMenuOpen(false)
    void navigate('/tokens/editor', {
      state: {
        campaignId,
        memberId: member.id,
        memberName: member.character_name || displayLabel,
      },
    })
  }

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setMenuOpen(false)
    if (file) onUpload(file)
  }

  const artStyle: CSSProperties = {
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
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Only someone who may set the art gets a button; for everyone else
          this is the picture alone, and the row beside it already names them. */}
      {canEdit ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          title={t('members.setArt')}
          aria-label={t('a11y.campaign.setArtFor', { name: displayLabel })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={busy}
          style={artStyle}
        >
          {member.has_art && member.id ? (
            <LazyImg
              // The version stamp busts the 5-minute upload cache, so art replaced
              // just now shows immediately rather than after it expires.
              src={campaigns.memberArtUrl(campaignId, member.id, artVersion)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : canEdit ? (
            <LuImagePlus size={16} aria-hidden="true" />
          ) : (
            (displayLabel?.[0]?.toUpperCase() ?? '?')
          )}
        </button>
      ) : (
        <span aria-hidden="true" style={artStyle}>
          {member.has_art && member.id ? (
            <LazyImg
              // The version stamp busts the 5-minute upload cache, so art replaced
              // just now shows immediately rather than after it expires.
              src={campaigns.memberArtUrl(campaignId, member.id, artVersion)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : canEdit ? (
            <LuImagePlus size={16} aria-hidden="true" />
          ) : (
            (displayLabel?.[0]?.toUpperCase() ?? '?')
          )}
        </span>
      )}

      {menuOpen && canEdit && (
        <>
          {/* A click anywhere else dismisses the menu. */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            ref={menuRef}
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

const menuItem: CSSProperties = {
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

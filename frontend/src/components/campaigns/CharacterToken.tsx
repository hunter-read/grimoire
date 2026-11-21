import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuWand, LuX } from 'react-icons/lu'

import { campaigns } from '../../api'
import LazyImg from '../LazyImg'

/**
 * A character's VTT token in a campaign: the framed disc made in the token
 * editor, kept apart from their art.
 *
 * A player's token is on their membership. The owner of a personal campaign
 * has no membership, so theirs is on the campaign - `memberId` null.
 *
 * The disc downloads the PNG, since a token is for dropping into a VTT. Someone
 * who may set it can also make a new one, which opens the editor bound to save
 * straight back here, or remove it. `canEdit` must match the server: the
 * member themselves or the campaign owner for a membership, the owner alone for
 * their own. With no token and no right to make one, nothing renders.
 */
interface CharacterTokenProps {
  campaignId: string
  memberId: string | null
  name: string
  hasToken: boolean
  canEdit: boolean
  onChanged?: () => void
}

export default function CharacterToken({
  campaignId,
  memberId,
  name,
  hasToken,
  canEdit,
  onChanged,
}: CharacterTokenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)

  if (!hasToken && !canEdit) return null

  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'character'

  const openEditor = () => {
    void navigate('/tokens/editor', {
      state: { campaignId, memberId: memberId ?? undefined, memberName: name, saveAs: 'token' },
    })
  }

  const remove = async () => {
    if (!confirm(t('members.removeTokenConfirm', { name }))) return
    setBusy(true)
    try {
      if (memberId) await campaigns.deleteMemberToken(campaignId, memberId)
      else await campaigns.deleteOwnerToken(campaignId)
      onChanged?.()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!hasToken) {
    return (
      <button
        type="button"
        onClick={openEditor}
        title={t('members.makeToken')}
        aria-label={t('members.makeTokenFor', { name })}
        style={{ ...disc, border: '1px dashed var(--border)', cursor: 'pointer' }}
      >
        <LuWand size={13} aria-hidden="true" />
      </button>
    )
  }

  // Coming back from the editor carries a fresh stamp, so a token replaced just
  // now is not served from the 5-minute upload cache.
  const version = (location.state as { artUpdated?: number } | null)?.artUpdated ?? null
  const url = memberId
    ? campaigns.memberTokenUrl(campaignId, memberId, version)
    : campaigns.ownerTokenUrl(campaignId, version)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <a
        href={url}
        download={`${slug}-token.png`}
        title={t('members.downloadToken')}
        aria-label={t('members.downloadTokenFor', { name })}
        style={{ ...disc, border: '1px solid var(--border)' }}
      >
        <LazyImg src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </a>
      {canEdit && (
        <>
          <button
            type="button"
            onClick={openEditor}
            disabled={busy}
            title={t('members.remakeToken')}
            aria-label={t('members.remakeTokenFor', { name })}
            style={iconBtn}
          >
            <LuWand size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            title={t('members.removeToken')}
            aria-label={t('members.removeTokenFor', { name })}
            style={iconBtn}
          >
            <LuX size={12} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}

const disc: CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: '50%',
  overflow: 'hidden',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: 'var(--text-muted)',
}

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: 4,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
}

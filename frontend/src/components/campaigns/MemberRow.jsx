import { useState, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuUserMinus,
  LuCheck,
  LuX,
  LuUser,
  LuPencil,
  LuImagePlus,
  LuFileText,
  LuUpload,
  LuDownload,
  LuTrash2,
  LuLink,
  LuFilePlus2,
  LuPencilLine,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import SheetTemplatePicker from './SheetTemplatePicker'
import ReplaceSheetDialog from './ReplaceSheetDialog'
import { STATUS_COLORS, sheetActionBtn, smallBtn } from './memberStyles'
import LazyImg from '../LazyImg'

// Lazy so pdf.js (a large dependency) is only fetched when a sheet is edited.
const PdfSheetEditor = lazy(() => import('./PdfSheetEditor'))

export default function MemberRow({
  member,
  isOwner,
  canManage,
  onRemove,
  onUpdateStatus,
  onSetCharacterName,
  currentUserId,
  campaignId,
  onMediaChanged,
}) {
  const { t } = useTranslation()
  const isCurrentUser = member.user_id === currentUserId
  const isMemberOwner = member.is_owner === true
  const [editingChar, setEditingChar] = useState(false)
  const [charValue, setCharValue] = useState(member.character_name ?? '')
  const artInputRef = useRef(null)
  const sheetInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [linkingSheet, setLinkingSheet] = useState(false)
  const [sheetUrlValue, setSheetUrlValue] = useState('')
  const [editingSheet, setEditingSheet] = useState(false)
  const [pickingTemplate, setPickingTemplate] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const displayLabel = member.display_name || member.username

  // A member's art/sheet can be edited by the member themselves or the campaign owner.
  // Requires the per-membership id (the synthetic owner row has none) and a campaignId.
  const canEditMedia = !!campaignId && !!member.id && !isMemberOwner && (isCurrentUser || canManage)

  const saveCharName = async () => {
    await onSetCharacterName(member.user_id, charValue.trim())
    setEditingChar(false)
  }

  const handleArtFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await campaigns.uploadMemberArt(campaignId, member.id, file)
      onMediaChanged?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSheetFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await campaigns.uploadMemberSheet(campaignId, member.id, file)
      onMediaChanged?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeSheet = async () => {
    setBusy(true)
    try {
      if (member.character_sheet_url) {
        await campaigns.setCharacterSheetUrl(campaignId, member.user_id, '')
      } else {
        await campaigns.deleteMemberSheet(campaignId, member.id)
      }
      onMediaChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const saveSheetUrl = async () => {
    const url = sheetUrlValue.trim()
    if (!url) {
      setLinkingSheet(false)
      return
    }
    setBusy(true)
    try {
      await campaigns.setCharacterSheetUrl(campaignId, member.user_id, url)
      setLinkingSheet(false)
      setSheetUrlValue('')
      onMediaChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const hasSheet = member.has_sheet || !!member.character_sheet_url

  // Re-uploading replaces the existing sheet, losing the prior version. Confirm first.
  const requestSheetUpload = () => {
    if (hasSheet) setConfirmReplace(true)
    else sheetInputRef.current?.click()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        type="button"
        onClick={canEditMedia ? () => artInputRef.current?.click() : undefined}
        title={canEditMedia ? t('members.uploadArt') : undefined}
        aria-label={canEditMedia ? t('members.uploadArt') : undefined}
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
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 600,
          color: isMemberOwner ? 'var(--gold)' : 'var(--text-dim)',
          cursor: canEditMedia ? 'pointer' : 'default',
        }}
      >
        {member.has_art && member.id ? (
          <LazyImg
            src={campaigns.memberArtUrl(campaignId, member.id)}
            alt={member.character_name || displayLabel}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : canEditMedia ? (
          <LuImagePlus size={16} aria-hidden="true" />
        ) : (
          (displayLabel?.[0]?.toUpperCase() ?? '?')
        )}
        {canEditMedia && (
          <input
            ref={artInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleArtFile}
            style={{ display: 'none' }}
          />
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Character name — primary */}
        {isMemberOwner ? (
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--gold)',
              fontFamily: 'Cinzel, serif',
            }}
          >
            {member.character_name}
          </div>
        ) : editingChar ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <input
              id={`char-name-${member.user_id}`}
              aria-label={t('members.characterNamePlaceholder')}
              value={charValue}
              onChange={(e) => setCharValue(e.target.value)}
              placeholder={t('members.characterNamePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCharName()
                if (e.key === 'Escape') setEditingChar(false)
              }}
              style={{
                fontSize: 14,
                padding: '3px 8px',
                borderRadius: 5,
                border: '1px solid var(--border)',
                background: 'var(--bg-deep)',
                color: 'var(--text)',
                width: 180,
              }}
            />
            <button
              onClick={saveCharName}
              style={{ ...smallBtn('var(--gold)'), padding: '3px 8px', fontSize: 12 }}
            >
              {t('members.save')}
            </button>
            <button
              onClick={() => setEditingChar(false)}
              style={{ ...smallBtn('var(--text-muted)'), padding: '3px 8px', fontSize: 12 }}
            >
              {t('members.cancel')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {member.character_name ? (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text)',
                  fontFamily: 'Cinzel, serif',
                }}
              >
                {member.character_name}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t('members.noCharacterName')}
              </span>
            )}
            {(canManage || isCurrentUser) && (
              <button
                onClick={() => {
                  setCharValue(member.character_name ?? '')
                  setEditingChar(true)
                }}
                aria-label={t('members.editCharacterName')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '1px 3px',
                  display: 'flex',
                }}
              >
                <LuPencil size={10} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {/* Username — secondary */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginTop: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <LuUser size={11} />
          {displayLabel}
          {isMemberOwner && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--gold)',
                fontWeight: 600,
                background: 'var(--bg-deep)',
                border: '1px solid var(--gold-dim)',
                borderRadius: 10,
                padding: '1px 6px',
                letterSpacing: '0.04em',
              }}
            >
              {t('members.gm')}
            </span>
          )}
          {member.is_guest && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                fontWeight: 600,
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '1px 6px',
                letterSpacing: '0.04em',
              }}
            >
              {t('guests.guest')}
            </span>
          )}
          {isCurrentUser && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('members.you')}</span>
          )}
          {member.campaign_access === false && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--danger)',
                fontWeight: 600,
                background: 'var(--bg-deep)',
                border: '1px solid var(--danger)',
                borderRadius: 10,
                padding: '1px 6px',
                letterSpacing: '0.04em',
              }}
            >
              {t('campaigns.memberAccessDisabled')}
            </span>
          )}
        </div>

        {/* Character sheet — uploaded file or an external link */}
        {!isMemberOwner && member.id && (hasSheet || canEditMedia) && (
          <div
            style={{
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              flexWrap: 'wrap',
            }}
          >
            {hasSheet ? (
              <>
                <a
                  href={
                    member.character_sheet_url || campaigns.memberSheetUrl(campaignId, member.id)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--gold)',
                    textDecoration: 'none',
                  }}
                >
                  <LuFileText size={12} aria-hidden="true" />
                  {member.character_sheet_url
                    ? t('members.characterSheetLink')
                    : member.character_sheet_filename || t('members.characterSheet')}
                  <LuDownload size={11} aria-hidden="true" />
                </a>
                {canEditMedia &&
                  !member.character_sheet_url &&
                  (member.character_sheet_filename || '').toLowerCase().endsWith('.pdf') && (
                    <button
                      onClick={() => setEditingSheet(true)}
                      disabled={busy}
                      style={sheetActionBtn}
                    >
                      <LuPencilLine size={11} aria-hidden="true" /> {t('members.editSheetInApp')}
                    </button>
                  )}
                {canEditMedia && (
                  <button
                    onClick={requestSheetUpload}
                    disabled={busy}
                    aria-label={t('members.replaceSheet')}
                    title={t('members.replaceSheet')}
                    style={sheetActionBtn}
                  >
                    <LuUpload size={11} aria-hidden="true" />
                  </button>
                )}
                {canEditMedia && (
                  <button
                    onClick={removeSheet}
                    disabled={busy}
                    aria-label={t('members.removeSheet')}
                    title={t('members.removeSheet')}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      padding: 1,
                    }}
                  >
                    <LuTrash2 size={11} aria-hidden="true" />
                  </button>
                )}
              </>
            ) : linkingSheet ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  value={sheetUrlValue}
                  onChange={(e) => setSheetUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveSheetUrl()
                    if (e.key === 'Escape') setLinkingSheet(false)
                  }}
                  placeholder={t('members.sheetUrlPlaceholder')}
                  autoFocus
                  style={{
                    fontSize: 12,
                    padding: '3px 6px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-deep)',
                    color: 'var(--text)',
                    width: 200,
                  }}
                />
                <button
                  onClick={saveSheetUrl}
                  disabled={busy}
                  style={{ ...smallBtn('var(--gold)'), padding: '3px 8px' }}
                >
                  {t('members.save')}
                </button>
                <button
                  onClick={() => setLinkingSheet(false)}
                  style={{ ...smallBtn('var(--text-muted)'), padding: '3px 8px' }}
                >
                  {t('members.cancel')}
                </button>
              </div>
            ) : (
              canEditMedia && (
                <>
                  <button
                    onClick={() => sheetInputRef.current?.click()}
                    disabled={busy}
                    style={sheetActionBtn}
                  >
                    <LuUpload size={11} aria-hidden="true" /> {t('members.uploadSheet')}
                  </button>
                  <button
                    onClick={() => setPickingTemplate(true)}
                    disabled={busy}
                    style={sheetActionBtn}
                  >
                    <LuFilePlus2 size={11} aria-hidden="true" /> {t('members.createFromTemplate')}
                  </button>
                  <button
                    onClick={() => {
                      setSheetUrlValue('')
                      setLinkingSheet(true)
                    }}
                    disabled={busy}
                    style={sheetActionBtn}
                  >
                    <LuLink size={11} aria-hidden="true" /> {t('members.linkSheet')}
                  </button>
                </>
              )
            )}
            {canEditMedia && (
              <input
                ref={sheetInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={handleSheetFile}
                style={{ display: 'none' }}
              />
            )}
            {editingSheet && (
              <Suspense fallback={null}>
                <PdfSheetEditor
                  campaignId={campaignId}
                  memberId={member.id}
                  onClose={() => setEditingSheet(false)}
                  onSaved={onMediaChanged}
                />
              </Suspense>
            )}
            {pickingTemplate && (
              <SheetTemplatePicker
                campaignId={campaignId}
                memberId={member.id}
                onClose={() => setPickingTemplate(false)}
                onDuplicated={() => {
                  setPickingTemplate(false)
                  onMediaChanged?.()
                  setEditingSheet(true)
                }}
              />
            )}
            {confirmReplace && (
              <ReplaceSheetDialog
                downloadUrl={
                  member.character_sheet_url || campaigns.memberSheetUrl(campaignId, member.id)
                }
                onCancel={() => setConfirmReplace(false)}
                onReplace={() => {
                  setConfirmReplace(false)
                  sheetInputRef.current?.click()
                }}
              />
            )}
          </div>
        )}
      </div>
      {!isMemberOwner && (
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 20,
            flexShrink: 0,
            background: 'var(--bg-deep)',
            color: STATUS_COLORS[member.status] || 'var(--text-muted)',
            border: `1px solid ${STATUS_COLORS[member.status] || 'var(--border)'}`,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
          }}
        >
          {member.status}
        </span>
      )}
      {isCurrentUser && member.status === 'invited' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onUpdateStatus(member.user_id, 'accepted')}
            aria-label={t('campaigns.accept')}
            style={smallBtn('var(--success)')}
          >
            <LuCheck size={13} aria-hidden="true" />
          </button>
          <button
            onClick={() => onUpdateStatus(member.user_id, 'declined')}
            aria-label={t('campaigns.decline')}
            style={smallBtn('var(--danger)')}
          >
            <LuX size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      {canManage && !isCurrentUser && !isMemberOwner && (
        <button
          onClick={() => onRemove(member.user_id)}
          aria-label={`Remove ${displayLabel}`}
          style={smallBtn('var(--text-muted)')}
        >
          <LuUserMinus size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuTag, LuInfo, LuChevronDown } from 'react-icons/lu'
import { useAuth } from '../../context/AuthContext'
import useImageGestures from '../../hooks/useImageGestures'

const isMobilePhone = window.matchMedia('(max-width: 640px)').matches

const getFolderPath = tok =>
  (tok.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1).join('/')
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { formatSize } from '../../utils'
import InlineTagEditor from '../maps/InlineTagEditor'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'

function MetaRow({ label, value }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 15, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function TagSection({ label, tags, onEdit, canEdit, editLabel, noTagsLabel }) {
  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {canEdit && (
          <button onClick={onEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <LuTag size={11} /> {editLabel}
          </button>
        )}
      </div>
      {tags.length > 0
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {tags.map(tag => <span key={tag} style={tagPillStyle}>{tag}</span>)}
          </div>
        : <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{noTagsLabel}</div>
      }
    </div>
  )
}

export default function TokenDetailView() {
  const { tokenId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin' || user?.role === 'gm'
  const [token, setToken] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [editingTokenTags, setEditingTokenTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const imagePane = useRef(null)

  // Load siblings for prev/next navigation
  useEffect(() => {
    api.get('/tokens').then(all => {
      if (!token) return
      const folder = getFolderPath(token)
      const sorted = all
        .filter(tok => getFolderPath(tok) === folder)
        .sort((a, b) => a.filename.localeCompare(b.filename))
      setSiblings(sorted)
    }).catch(() => {})
  }, [token])

  const siblingIdx = siblings.findIndex(tok => tok.id === tokenId)
  const onNext = useCallback(() => {
    if (siblingIdx < siblings.length - 1) navigate(`/tokens/${siblings[siblingIdx + 1].id}`)
  }, [siblingIdx, siblings, navigate])
  const onPrev = useCallback(() => {
    if (siblingIdx > 0) navigate(`/tokens/${siblings[siblingIdx - 1].id}`)
  }, [siblingIdx, siblings, navigate])

  const { imageStyle } = useImageGestures({ onNext, onPrev, containerRef: imagePane, resetKey: tokenId })

  useEffect(() => { api.get(`/tokens/${tokenId}`).then(setToken) }, [tokenId])

  if (!token) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={32} /></div>

  const folder = (() => {
    const parts = (token.relative_path || '').replace(/\\/g, '/').split('/')
    const dirParts = parts.slice(1, -1)
    return dirParts.length > 0 ? dirParts.join(' / ') : null
  })()

  const currentFolderTags = token.folder_tags ?? []

  const saveTokenTags = async (tags) => {
    await api.patch(`/tokens/${tokenId}`, { tags })
    setToken({ ...token, tags })
    setEditingTokenTags(false)
  }

  const saveFolderTags = async (tags) => {
    await api.patch('/token-folders', { path: token.folder_path, tags })
    setToken({ ...token, folder_tags: tags })
    setEditingFolderTags(false)
  }

  const toggleExplicit = async () => {
    const next = !token.is_explicit
    await api.patch(`/tokens/${tokenId}`, { is_explicit: next })
    setToken({ ...token, is_explicit: next })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
        background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={() => navigate('/tokens')} aria-label={t('tokens.detail.back')} style={{
          background: 'none', color: 'var(--text-dim)', fontSize: 15, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <LuArrowLeft size={15} /> {t('common.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span style={{ fontSize: 16, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {token.filename}
        </span>
        {isMobilePhone && (
          <button
            onClick={() => setShowDetails(v => !v)}
            title={t('tokens.detail.details')}
            style={{
              background: showDetails ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: '1px solid var(--border)', color: showDetails ? 'var(--gold)' : 'var(--text-dim)',
              borderRadius: 4, padding: '4px 10px', fontSize: 14, display: 'inline-flex',
              alignItems: 'center', gap: 4, cursor: 'pointer',
            }}
          >
            <LuInfo size={13} />
            <LuChevronDown size={11} style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        )}
        <AddToCampaignButton resourceType="token" resourceId={tokenId} />
        <a href={mediaUrl(`/tokens/${tokenId}/file`)} download style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-dim)',
          borderRadius: 4, padding: '4px 12px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 5,
          textDecoration: 'none',
        }}>
          <LuDownload size={13} /> {t('common.download')}
        </a>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: isMobilePhone ? 'column' : 'row' }}>
        {/* Image pane */}
        <div ref={imagePane} style={{ flex: 1, overflow: 'auto', background: 'var(--bg-deep)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24 }}>
          <img
            src={mediaUrl(`/tokens/${tokenId}/file`)}
            alt={token.filename}
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.6)', ...imageStyle }}
            draggable={false}
          />
        </div>

        {/* Metadata sidebar — always visible on desktop, toggle-controlled on mobile */}
        <div style={{
          ...(isMobilePhone
            ? { display: showDetails ? 'block' : 'none', width: '100%', borderTop: '1px solid var(--border)', maxHeight: '50vh' }
            : { width: 260, flexShrink: 0, borderLeft: '1px solid var(--border)' }
          ),
          background: 'var(--bg-panel)', padding: '24px 20px', overflowY: 'auto',
        }}>
          <h3 style={{ fontSize: 15, marginBottom: 20 }}>{t('tokens.detail.title')}</h3>

          {canEdit && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 'fit-content' }}>
                <input
                  type="checkbox"
                  checked={token.is_explicit || false}
                  onChange={toggleExplicit}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#e07070' }}
                />
                <span style={{ fontSize: 13, color: '#e07070' }}>{t('tokens.detail.explicitContent')}</span>
              </label>
            </div>
          )}
          {folder && <MetaRow label={t('tokens.detail.location')} value={folder} />}
          <MetaRow label={t('tokens.detail.fileSize')} value={formatSize(token.file_size)} />
          {token.pixel_width != null && (
            <MetaRow label={t('tokens.detail.resolution')} value={t('tokens.detail.resolutionValue', { width: token.pixel_width, height: token.pixel_height })} />
          )}

          {/* Folder tags */}
          {folder && (
            editingFolderTags
              ? <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('tokens.detail.folderTags')}</div>
                  <InlineTagEditor
                    tags={currentFolderTags}
                    onSave={saveFolderTags}
                    onCancel={() => setEditingFolderTags(false)}
                  />
                </div>
              : <TagSection
                  label={t('tokens.detail.folderTags')}
                  tags={currentFolderTags}
                  canEdit={true}
                  onEdit={() => setEditingFolderTags(true)}
                  editLabel={t('tokens.detail.editTags')}
                  noTagsLabel={t('tokens.detail.noTags')}
                />
          )}

          {/* Token tags */}
          {editingTokenTags
            ? <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('tokens.detail.tokenTags')}</div>
                <InlineTagEditor
                  tags={token.tags}
                  onSave={saveTokenTags}
                  onCancel={() => setEditingTokenTags(false)}
                />
              </div>
            : <TagSection
                label={t('tokens.detail.tokenTags')}
                tags={token.tags}
                canEdit
                onEdit={() => setEditingTokenTags(true)}
                editLabel={t('tokens.detail.editTags')}
                noTagsLabel={t('tokens.detail.noTags')}
              />
          }
        </div>
      </div>
    </div>
  )
}

const tagPillStyle = {
  fontSize: 12, padding: '2px 8px', borderRadius: 10,
  background: 'var(--tag-bg)', border: '1px solid var(--tag-border)', color: 'var(--text-dim)',
}

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuX,
  LuSearch,
  LuBookOpen,
  LuMap,
  LuUser,
  LuMusic,
  LuFile,
  LuImage,
  LuPlus,
  LuUpload,
} from 'react-icons/lu'
import { campaigns, mediaUrl } from '../../api'
import Spinner from '../Spinner'
import ImageUploadPanel from './ImageUploadPanel'
import { miniBtn, miniBtnGhost } from './embedPickerStyles'
import LazyImg from '../LazyImg'

const TYPE_ICON = { book: LuBookOpen, map: LuMap, token: LuUser, audio: LuMusic, file: LuFile }

// Picks a linked campaign resource (or uploads a new image) and returns the
// [[...]] embed token to insert into a wiki note. Only resources already linked
// to this campaign are listed — to embed new library content, link it first in
// the Resources panel.
export default function GrimoireEmbedPicker({ campaignId, onInsert, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [resources, setResources] = useState(null)
  const [pageFor, setPageFor] = useState(null) // book item awaiting a page number
  const [pageNum, setPageNum] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    campaigns
      .listResources(campaignId)
      .then((list) => setResources(list || []))
      .catch(() => setResources([]))
  }, [campaignId])

  // The embed token for a resource. Images use the `image:` prefix so they render
  // inline; other files use `file:`; books optionally carry a page number.
  const tokenFor = (item, page) => {
    if (item.resource_type === 'file') {
      return item.is_image ? `[[image:${item.resource_id}]]` : `[[file:${item.resource_id}]]`
    }
    if (item.resource_type === 'book' && page) {
      return `[[book:${item.resource_id}:${page}]]`
    }
    return `[[${item.resource_type}:${item.resource_id}]]`
  }

  const insert = (item, page) => onInsert(tokenFor(item, page))

  const handleUploaded = (created) => {
    setUploadOpen(false)
    // The new image is a linked resource; embed it immediately.
    onInsert(`[[image:${created.resource_id}]]`)
  }

  const filtered = (resources || []).filter((r) =>
    (r.name || '').toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 480,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
          {t('wiki.embedPickerTitle')}
        </h3>

        {uploadOpen ? (
          <ImageUploadPanel
            campaignId={campaignId}
            onUploaded={handleUploaded}
            onCancel={() => setUploadOpen(false)}
          />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <LuSearch
                  size={14}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('wiki.embedSearchPlaceholder')}
                  style={{
                    width: '100%',
                    padding: '9px 12px 9px 32px',
                    background: 'var(--bg-deep)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <button
                onClick={() => setUploadOpen(true)}
                style={miniBtn}
                title={t('wiki.uploadImage')}
              >
                <LuImage size={14} /> {t('wiki.uploadImage')}
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {resources === null ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                  <Spinner size={18} />
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 4px' }}>
                  {resources.length === 0 ? t('wiki.noLinkedResources') : t('common.noResults')}
                </div>
              ) : (
                filtered.map((item) => {
                  const isImage = item.resource_type === 'file' && item.is_image
                  const Icon = isImage ? LuImage : TYPE_ICON[item.resource_type] || LuBookOpen
                  const key = item.id
                  const awaitingPage = pageFor === key
                  const thumbUrl = thumbnailUrl(campaignId, item)
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 6px',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          flexShrink: 0,
                          overflow: 'hidden',
                          background: 'var(--bg-deep)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {thumbUrl ? (
                          <LazyImg
                            src={thumbUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Icon size={15} style={{ color: 'var(--text-muted)' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.name}
                        </div>
                      </div>

                      {awaitingPage ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            min="1"
                            value={pageNum}
                            onChange={(e) => setPageNum(e.target.value)}
                            placeholder={t('wiki.pageNum')}
                            aria-label={t('wiki.pageNum')}
                            style={{
                              width: 64,
                              padding: '4px 6px',
                              background: 'var(--bg-deep)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              color: 'var(--text)',
                              fontSize: 12,
                            }}
                          />
                          <button
                            onClick={() => insert(item, pageNum || null)}
                            style={miniBtn}
                            title={t('wiki.insert')}
                          >
                            {t('wiki.insert')}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {item.resource_type === 'book' && (
                            <button
                              onClick={() => {
                                setPageFor(key)
                                setPageNum('')
                              }}
                              style={miniBtnGhost}
                              title={t('wiki.withPage')}
                            >
                              {t('wiki.withPage')}
                            </button>
                          )}
                          <button onClick={() => insert(item, null)} style={miniBtn}>
                            <LuPlus size={13} /> {t('wiki.insert')}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Thumbnail URL for a resource row, or null when there's nothing to show.
function thumbnailUrl(campaignId, item) {
  if (item.resource_type === 'file') {
    return item.is_image ? campaigns.fileUrl(campaignId, item.resource_id) : null
  }
  if (!item.has_thumbnail) return null
  // Audio has no thumbnail endpoint — it serves folder/embedded artwork instead.
  if (item.resource_type === 'audio') {
    return mediaUrl(`/audio/${item.resource_id}/artwork`)
  }
  const seg = item.resource_type === 'book' ? 'books' : `${item.resource_type}s`
  return mediaUrl(`/${seg}/${item.resource_id}/thumbnail`)
}

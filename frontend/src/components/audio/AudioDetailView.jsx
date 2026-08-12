import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuInfo, LuChevronDown, LuMusic } from 'react-icons/lu'
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { formatSize, formatDuration } from '../../utils'
import InlineTagEditor from '../maps/InlineTagEditor'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'
import MetaRow from '../MetaRow'
import TagSection from '../TagSection'
import AudioPlayer from './AudioPlayer'
import ArchivePlaceholder from '../media/ArchivePlaceholder'
import { isArchiveMedia } from '../../constants'
import useIsMobile from '../../hooks/useIsMobile'

export default function AudioDetailView() {
  const { audioId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isMobilePhone = useIsMobile(640)
  const [track, setTrack] = useState(null)
  const [editingTrackTags, setEditingTrackTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    api.get(`/audio/${audioId}`).then(setTrack)
  }, [audioId])

  if (!track)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const folder = (() => {
    const parts = (track.relative_path || '').replace(/\\/g, '/').split('/')
    const dirParts = parts.slice(1, -1)
    return dirParts.length > 0 ? dirParts.join(' / ') : null
  })()

  const currentFolderTags = track.folder_tags ?? []
  const isArchive = isArchiveMedia(track)

  const saveTrackTags = async (tags) => {
    await api.patch(`/audio/${audioId}`, { tags })
    setTrack({ ...track, tags })
    setEditingTrackTags(false)
  }

  const saveFolderTags = async (tags) => {
    await api.patch('/audio-folders', { path: track.folder_path, tags })
    setTrack({ ...track, folder_tags: tags })
    setEditingFolderTags(false)
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => navigate('/audio')}
          aria-label={t('audio.detail.back')}
          style={{
            background: 'none',
            color: 'var(--text-dim)',
            fontSize: 15,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuArrowLeft size={15} /> {!isMobilePhone && t('common.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.title || track.filename}
        </span>
        {isMobilePhone && (
          <button
            onClick={() => setShowDetails((v) => !v)}
            title={t('audio.detail.details')}
            style={{
              background: showDetails ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: showDetails ? 'var(--gold)' : 'var(--text-dim)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <LuInfo size={13} />
            <LuChevronDown
              size={11}
              style={{
                transform: showDetails ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </button>
        )}
        <AddToCampaignButton resourceType="audio" resourceId={audioId} />
        <a
          href={mediaUrl(`/audio/${audioId}/file`)}
          download
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            textDecoration: 'none',
          }}
        >
          <LuDownload size={13} /> {!isMobilePhone && t('common.download')}
        </a>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: isMobilePhone ? 'column' : 'row',
        }}
      >
        {/* Player / archive pane */}
        {isArchive ? (
          <ArchivePlaceholder fileUrl={`/audio/${audioId}/file`} filename={track.filename} />
        ) : (
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--bg-deep)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
              padding: 24,
            }}
          >
            <div
              style={{
                width: 'min(360px, 70vw)',
                aspectRatio: '1/1',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 24px var(--overlay)',
              }}
            >
              {track.has_artwork ? (
                <img
                  src={mediaUrl(`/audio/${audioId}/artwork`)}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <LuMusic size={72} color="var(--text-muted)" style={{ opacity: 0.4 }} />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AudioPlayer
                track={{
                  id: audioId,
                  title: track.title || track.filename,
                  artwork: track.has_artwork,
                }}
                showPlayNext
                size={56}
              />
            </div>
          </div>
        )}

        {/* Metadata sidebar */}
        <div
          style={{
            ...(isMobilePhone
              ? {
                  display: showDetails ? 'block' : 'none',
                  width: '100%',
                  borderTop: '1px solid var(--border)',
                  maxHeight: '50vh',
                }
              : { width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)' }),
            background: 'var(--bg-panel)',
            padding: '24px 20px',
            overflowY: 'auto',
          }}
        >
          <h3 style={{ fontSize: 15, marginBottom: 20 }}>{t('audio.detail.title')}</h3>

          {folder && <MetaRow label={t('audio.detail.location')} value={folder} />}
          {track.title && <MetaRow label={t('audio.detail.trackTitle')} value={track.title} />}
          {track.artist && <MetaRow label={t('audio.detail.artist')} value={track.artist} />}
          {track.album && <MetaRow label={t('audio.detail.album')} value={track.album} />}
          {track.duration > 0 && (
            <MetaRow label={t('audio.detail.duration')} value={formatDuration(track.duration)} />
          )}
          <MetaRow label={t('audio.detail.fileSize')} value={formatSize(track.file_size)} />

          {/* Folder tags */}
          {folder &&
            (editingFolderTags ? (
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginBottom: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('audio.detail.folderTags')}
                </div>
                <InlineTagEditor
                  tags={currentFolderTags}
                  onSave={saveFolderTags}
                  onCancel={() => setEditingFolderTags(false)}
                  resourceType="audio"
                />
              </div>
            ) : (
              <TagSection
                label={t('audio.detail.folderTags')}
                tags={currentFolderTags}
                canEdit={true}
                onEdit={() => setEditingFolderTags(true)}
                editLabel={t('audio.detail.editTags')}
                noTagsLabel={t('audio.detail.noTags')}
              />
            ))}

          {/* Track tags */}
          {editingTrackTags ? (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t('audio.detail.trackTags')}
              </div>
              <InlineTagEditor
                tags={track.tags}
                onSave={saveTrackTags}
                onCancel={() => setEditingTrackTags(false)}
                resourceType="audio"
              />
            </div>
          ) : (
            <TagSection
              label={t('audio.detail.trackTags')}
              tags={track.tags}
              canEdit
              onEdit={() => setEditingTrackTags(true)}
              editLabel={t('audio.detail.editTags')}
              noTagsLabel={t('audio.detail.noTags')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuWand } from 'react-icons/lu'
import Spinner from '../components/Spinner'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import { useAuth } from '../context/AuthContext'
import useMediaGallery from '../hooks/useMediaGallery'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import GalleryLayout from '../components/media/GalleryLayout'
import gallerySubtitle from '../components/media/gallerySubtitle'

export default function TokensView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isPlayer = user?.role === 'player'
  const config = MEDIA_CONFIGS.token
  const gallery = useMediaGallery(config)

  const [downloadModal, setDownloadModal] = useState(null)
  const [showAddToCampaign, setShowAddToCampaign] = useState(false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)

  if (!gallery.data)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  return (
    <>
      <GalleryLayout
        config={config}
        gallery={gallery}
        isPlayer={isPlayer}
        title={t('tokens.title')}
        subtitle={gallerySubtitle(t, 'tokens', {
          count: gallery.filteredCount,
          total: gallery.totalCount,
          loading: gallery.loadingMore,
          available: gallery.totalAvailable,
        })}
        onDownload={setDownloadModal}
        onAddToCampaign={() => setShowAddToCampaign(true)}
        onBulkEdit={() => setShowBulkEdit(true)}
        headerActions={
          /* The standalone entry: "I have a picture on my phone". Styled as the
             audio gallery's "Saved sets" button is — it takes the slack at the
             head of the toolbar row so the row ends flush with the search box
             above rather than leaving a ragged gap. */
          <button
            type="button"
            onClick={() => navigate('/tokens/editor')}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-dim)',
              fontSize: 13,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            <LuWand size={14} aria-hidden="true" />
            {t('tokenEditor.title')}
          </button>
        }
      />

      {downloadModal && (
        <DownloadArchiveModal
          title={downloadModal.title}
          params={downloadModal.params}
          onClose={() => setDownloadModal(null)}
        />
      )}

      {showAddToCampaign && (
        <AddToCampaignModal
          items={gallery
            .selectedObjects()
            .map((tok) => ({ resource_type: 'token', resource_id: tok.id }))}
          onClose={() => setShowAddToCampaign(false)}
          onAdded={() => setShowAddToCampaign(false)}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="token"
          items={gallery.selectedObjects()}
          onClose={() => setShowBulkEdit(false)}
          onSaved={(edited) => {
            gallery.applyEdits(edited)
            setShowBulkEdit(false)
          }}
        />
      )}
    </>
  )
}

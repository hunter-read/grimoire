import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuPencilRuler } from 'react-icons/lu'
import Spinner from '../components/Spinner'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import BulkActionBar from '../components/BulkActionBar'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import { useAuth } from '../context/AuthContext'
import useMediaGallery from '../hooks/useMediaGallery'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import GalleryLayout from '../components/media/GalleryLayout'
import gallerySubtitle from '../components/media/gallerySubtitle'

export default function MapsView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isPlayer = user?.role === 'player'
  const config = MEDIA_CONFIGS.map
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
        title={t('maps.title')}
        subtitle={gallerySubtitle(t, 'maps', {
          count: gallery.filteredCount,
          total: gallery.totalCount,
          loading: gallery.loadingMore,
          available: gallery.totalAvailable,
        })}
        onDownload={setDownloadModal}
        onAddToCampaign={() => setShowAddToCampaign(true)}
        onBulkEdit={() => setShowBulkEdit(true)}
        headerActions={
          /* The standalone entry, as the token gallery has: "I have a map that
             isn't in the library yet". Players are left out — the editor's
             exits are a download and a campaign upload, and the latter is
             GM-only, so the page would be half unusable for them. */
          !isPlayer && (
            <button
              type="button"
              onClick={() => navigate('/maps/editor')}
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
              <LuPencilRuler size={14} aria-hidden="true" />
              {t('maps.vtt.title')}
            </button>
          )
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
            .map((m) => ({ resource_type: 'map', resource_id: m.id }))}
          onClose={() => setShowAddToCampaign(false)}
          onAdded={() => setShowAddToCampaign(false)}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="map"
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

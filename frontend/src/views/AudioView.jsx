import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../components/Spinner'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import { useAuth } from '../context/AuthContext'
import { useSoundboard } from '../context/SoundboardContext'
import useMediaGallery from '../hooks/useMediaGallery'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import GalleryLayout from '../components/media/GalleryLayout'
import gallerySubtitle from '../components/media/gallerySubtitle'

export default function AudioView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isPlayer = user?.role === 'player'
  const config = MEDIA_CONFIGS.audio
  const gallery = useMediaGallery(config)
  const { addPads } = useSoundboard()

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
        title={t('audio.title')}
        subtitle={gallerySubtitle(t, 'audio', {
          count: gallery.filteredCount,
          total: gallery.totalCount,
        })}
        onDownload={setDownloadModal}
        onAddToCampaign={() => setShowAddToCampaign(true)}
        onBulkEdit={() => setShowBulkEdit(true)}
        onAddToSoundboard={() => {
          // Adding many at once is the same gesture as any other bulk action:
          // select, click, done — the board opens showing the new pads.
          addPads(
            gallery.selectedObjects().map((a) => ({ id: a.id, title: a.title || a.filename }))
          )
          gallery.bulk.exit()
        }}
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
            .map((a) => ({ resource_type: 'audio', resource_id: a.id }))}
          onClose={() => setShowAddToCampaign(false)}
          onAdded={() => setShowAddToCampaign(false)}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="audio"
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

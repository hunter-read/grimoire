import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../components/Spinner'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import { useAuth } from '../context/AuthContext'
import useMediaGallery from '../hooks/useMediaGallery'
import { MEDIA_CONFIGS } from '../components/media/mediaConfig'
import GalleryLayout from '../components/media/GalleryLayout'

export default function TokensView() {
  const { t } = useTranslation()
  const { user } = useAuth()
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
        subtitle={t('tokens.subtitle', { count: gallery.data.total })}
        onDownload={setDownloadModal}
        onAddToCampaign={() => setShowAddToCampaign(true)}
        onBulkEdit={() => setShowBulkEdit(true)}
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

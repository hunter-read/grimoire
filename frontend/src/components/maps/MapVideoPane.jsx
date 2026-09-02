import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../api'
import Spinner from '../Spinner'

/**
 * Player pane for animated battlemaps (.webm/.mp4).
 *
 * Publishers like CzePeku ship looping video variants alongside the stills, so
 * these behave like a map, not like a movie: they loop, start muted (many carry
 * no audio at all, and an autoplaying soundtrack at the table is unwelcome), and
 * autoplay — muted autoplay is what browsers allow without a user gesture.
 * Controls stay on so the GM can pause or scrub.
 */
export default function MapVideoPane({ mapId, filename, isMobilePhone }) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setReady(false)
    setFailed(false)
  }, [mapId])

  return (
    <>
      {!ready && !failed && (
        <div
          aria-live="polite"
          style={{
            position: 'absolute',
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Spinner size={32} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('maps.detail.loading')}
          </span>
        </div>
      )}
      {failed ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('maps.detail.videoFailed')}</p>
      ) : (
        <video
          key={mapId}
          src={mediaUrl(`/maps/${mapId}/file`)}
          aria-label={filename}
          controls
          loop
          muted
          autoPlay
          playsInline
          preload="metadata"
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
          style={{
            maxWidth: '100%',
            maxHeight: isMobilePhone ? undefined : 'calc(100vh - 60px)',
            borderRadius: 4,
            boxShadow: '0 4px 24px var(--overlay)',
            opacity: ready ? 1 : 0,
            transition: 'opacity 0.15s ease-in',
          }}
        />
      )}
    </>
  )
}

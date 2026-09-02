import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'

/**
 * Viewer for Universal VTT exports (.uvtt/.dd2vtt).
 *
 * A UVTT file is a JSON envelope: the battlemap as base64 plus the wall, portal,
 * and light data a VTT uses for dynamic lighting. The image is fetched from the
 * server already decoded (`/vtt/image`) rather than pulled out of the base64
 * here, and the feature data comes separately (`/vtt/data`) so the envelope
 * never crosses the wire.
 *
 * See https://arkenforge.com/universal-vtt-files/ for the format.
 */
export default function MapVttPane({ mapId, filename, isMobilePhone, onData }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [mapId])

  // Feature counts are surfaced in the sidebar by the parent.
  useEffect(() => {
    let cancelled = false
    api
      .get(`/maps/${mapId}/vtt/data`)
      .then((d) => {
        if (!cancelled) onData?.(d)
      })
      .catch(() => {
        if (!cancelled) onData?.(null)
      })
    return () => {
      cancelled = true
    }
  }, [mapId, onData])

  return (
    <>
      {!loaded && !failed && (
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
        <p style={{ color: 'var(--text-muted)' }}>{t('maps.detail.vttFailed')}</p>
      ) : (
        <img
          key={mapId}
          src={mediaUrl(`/maps/${mapId}/vtt/image`)}
          alt={filename}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            maxWidth: '100%',
            maxHeight: isMobilePhone ? undefined : 'calc(100vh - 60px)',
            borderRadius: 4,
            boxShadow: '0 4px 24px var(--overlay)',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.15s ease-in',
          }}
          draggable={false}
        />
      )}
    </>
  )
}

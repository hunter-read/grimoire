import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../api'
import Spinner from '../Spinner'

/**
 * The raster pane of the map detail view.
 *
 * Two problems this solves (issue: slow map viewing):
 *
 * 1. It requests the downscaled `/page/1` render rather than the original file.
 *    A 50MB battlemap took seconds to paint because the browser had to pull the
 *    whole thing; the server-side WebP preview is a few hundred KB.
 * 2. It shows a spinner *over the previous map* while the next one decodes.
 *    Previously the `<img>` src simply changed, so React kept the old picture on
 *    screen with no indication anything was happening — pressing next looked
 *    broken until the new map abruptly popped in.
 *
 * While the full preview loads, the (already-cached) thumbnail is shown blurred
 * underneath, so the pane immediately reflects the map being navigated to
 * instead of the one the user just left.
 */
export default function MapImagePane({ mapId, filename, hasThumbnail, imageStyle, isMobilePhone }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reset per map: a new id means a new image to wait for. Keyed state rather
  // than an onLoad-only reset so a cached image that fires load synchronously
  // still starts from a clean slate.
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [mapId])

  const src = mediaUrl(`/maps/${mapId}/page/1`, { width: 2000 })

  return (
    <>
      {/* Blurred thumbnail placeholder — instant, and already in cache from the
          gallery the user came from. */}
      {!loaded && hasThumbnail && !failed && (
        <img
          src={mediaUrl(`/maps/${mapId}/thumbnail`)}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            maxWidth: '80%',
            maxHeight: '80%',
            filter: 'blur(12px)',
            opacity: 0.35,
            borderRadius: 4,
          }}
          draggable={false}
        />
      )}

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
        <p style={{ color: 'var(--text-muted)' }}>{t('maps.detail.loadFailed')}</p>
      ) : (
        <img
          // Keying by id drops the decoded previous map instead of holding it on
          // screen behind the spinner.
          key={mapId}
          src={src}
          alt={filename}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            maxWidth: '100%',
            maxHeight: isMobilePhone ? undefined : 'calc(100vh - 60px)',
            borderRadius: 4,
            boxShadow: '0 4px 24px var(--overlay)',
            // Held invisible rather than unmounted so the browser actually
            // fetches and decodes it while the spinner shows.
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.15s ease-in',
            ...imageStyle,
          }}
          draggable={false}
        />
      )}
    </>
  )
}

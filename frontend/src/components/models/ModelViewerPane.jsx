import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRotateCcw, LuBox, LuDownload, LuTriangleAlert } from 'react-icons/lu'
import Spinner from '../Spinner'
import { mediaUrl } from '../../api'

/**
 * The 3D preview on a model's detail page.
 *
 * All the WebGL work lives in `src/lib/three.js`; this component owns the state
 * machine around it — loading, loaded, error, and the two "no viewer" cases
 * (a format with no loader, and a mesh too large to hand a browser). That split
 * is deliberate: jsdom has no WebGL, so the lib is mocked in tests and every
 * branch here stays exercisable.
 */
export default function ModelViewerPane({ model, height = 420 }) {
  const { t } = useTranslation()
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [wireframe, setWireframe] = useState(false)

  const loader = model?.viewer_loader || ''
  const oversized = !!model?.viewer_oversized
  // An oversized mesh is loadable, just not without being asked for: the user
  // opts in per visit, and the choice deliberately does not persist, since the
  // next model may be heavier than this one.
  //
  // The opt-in stores the id it was given for, rather than a bare boolean reset
  // by an effect. An effect runs *after* the render that changed model.id, so
  // for one render `forced` would still be true against the new model and the
  // load effect would start fetching a mesh the user never agreed to — the
  // exact hang this gate exists to prevent.
  const [forcedId, setForcedId] = useState(null)
  const forced = !!model?.id && forcedId === model.id
  const available = !!model?.viewer_available || (oversized && forced)

  useEffect(() => {
    if (!available || !loader || !hostRef.current) return undefined

    let cancelled = false
    setStatus('loading')

    import('../../lib/three')
      .then(({ createViewer }) =>
        createViewer(hostRef.current, mediaUrl(`/models/${model.id}/file`), loader)
      )
      .then((viewer) => {
        // The effect can be torn down while the mesh is still downloading; the
        // viewer that arrives afterwards owns a live WebGL context, so it has to
        // be disposed rather than dropped.
        if (cancelled) {
          viewer.dispose()
          return
        }
        viewerRef.current = viewer
        setStatus('loaded')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      // Browsers cap concurrent WebGL contexts, so a leak here blanks the
      // viewer after a dozen models with nothing to explain why.
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [model?.id, loader, available])

  const toggleWireframe = () => {
    const next = !wireframe
    setWireframe(next)
    viewerRef.current?.setWireframe(next)
  }

  const frameStyle = {
    position: 'relative',
    height,
    borderRadius: 8,
    overflow: 'hidden',
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  // Past the size cap but renderable: warn, then let the user decide. The mesh
  // may well be slow or exhaust the tab, which is exactly why this is a
  // deliberate click rather than something the page does on their behalf.
  if (!available && oversized) {
    return (
      <div style={frameStyle}>
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
          <LuTriangleAlert size={40} style={{ opacity: 0.5, color: 'var(--gold)' }} />
          <p style={{ margin: '12px 0 4px', fontSize: 14 }}>{t('models.viewerTooLarge')}</p>
          <p style={{ margin: '0 0 12px', fontSize: 13, maxWidth: 360 }}>
            {t('models.viewerOversizedWarning')}
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center' }}>
            <button
              onClick={() => setForcedId(model?.id ?? null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                fontSize: 13,
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--text-dim)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
              }}
            >
              <LuBox size={14} /> {t('models.viewerLoadAnyway')}
            </button>
            <a
              href={mediaUrl(`/models/${model.id}/file`)}
              download={model.filename}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--accent)',
              }}
            >
              <LuDownload size={14} /> {t('models.download')}
            </a>
          </div>
        </div>
      </div>
    )
  }

  // No loader at all for this format (a sliced printer file, a multi-file
  // .obj). Nothing the user can consent to will render it, so a download is the
  // only thing on offer.
  if (!available) {
    return (
      <div style={frameStyle}>
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
          <LuBox size={40} style={{ opacity: 0.35 }} />
          <p style={{ margin: '12px 0 4px', fontSize: 14 }}>{t('models.viewerUnavailable')}</p>
          <a
            href={mediaUrl(`/models/${model.id}/file`)}
            download={model.filename}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 10,
              fontSize: 13,
              color: 'var(--accent)',
            }}
          >
            <LuDownload size={14} /> {t('models.download')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={frameStyle}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} data-testid="model-canvas" />

      {status === 'loading' && (
        <div style={{ position: 'relative', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Spinner size={28} />
          <p style={{ marginTop: 10, fontSize: 13 }}>{t('models.viewerLoading')}</p>
        </div>
      )}

      {status === 'error' && (
        <div style={{ position: 'relative', textAlign: 'center', color: 'var(--text-muted)' }}>
          <LuBox size={36} style={{ opacity: 0.35 }} />
          <p style={{ margin: '10px 0 0', fontSize: 13 }}>{t('models.viewerError')}</p>
        </div>
      )}

      {status === 'loaded' && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            gap: 6,
          }}
        >
          <button
            onClick={toggleWireframe}
            aria-pressed={wireframe}
            title={t('models.wireframe')}
            style={viewerButtonStyle(wireframe)}
          >
            <LuBox size={14} /> {t('models.wireframe')}
          </button>
          <button
            onClick={() => viewerRef.current?.resetView()}
            title={t('models.resetView')}
            style={viewerButtonStyle(false)}
          >
            <LuRotateCcw size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function viewerButtonStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 9px',
    fontSize: 12,
    borderRadius: 6,
    cursor: 'pointer',
    color: active ? 'var(--on-accent)' : 'var(--text-dim)',
    background: active ? 'var(--accent)' : 'var(--overlay)',
    border: '1px solid var(--border)',
  }
}

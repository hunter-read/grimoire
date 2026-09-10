import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LuArrowLeft, LuDownload, LuUserRound } from 'react-icons/lu'

import { campaigns as campaignsApi, imageSources, mediaUrl } from '../../../api'
import { useAuth } from '../../../context/AuthContext'
import Spinner from '../../Spinner'
import { OUTPUT_SIZES, composeToBlob, loadImage } from '../../../lib/tokenCompositor'
import { frameApertureMask } from '../../../lib/frameMask'
import { resolveIconColor } from '../../campaigns/iconColors'
import FramePicker from './FramePicker'
import SetAsArtDialog from './SetAsArtDialog'
import TokenEditorCanvas from './TokenEditorCanvas'
import TokenEditorControls from './TokenEditorControls'
import TokenSourcePicker from './TokenSourcePicker'
import { fetchFrames, frameIsRecolourable, frameUrl } from './frames'
import { DEFAULT_FRAME_COLOR } from './genericFrames'
import useTokenTransform from './useTokenTransform'

/**
 * The token editor.
 *
 * Everything here is client-side: the composed PNG is built in the browser and
 * leaves by one of two doors — a download, or the existing character-art
 * endpoint. Nothing is written to the library and no Token row is created, so
 * the editor works against a read-only library and never disturbs the indexer.
 */

const DEFAULT_SIZE = 256

export default function TokenEditorView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { tokenId } = useParams()
  const { user } = useAuth()

  // A member target arrives in router state rather than the URL: a membership id
  // in the address bar is noise, and state survives the back button.
  const target = location.state || {}

  const [source, setSource] = useState(null)
  const [loadingSource, setLoadingSource] = useState(!!tokenId)
  const [frames, setFrames] = useState(null)
  const [frameId, setFrameId] = useState(null)
  const [frameImage, setFrameImage] = useState(null)
  const [mask, setMask] = useState('circle')
  // Stored as an icon-colour token or "#rrggbb" (empty = transparent), the same
  // vocabulary campaign icons use, and resolved only at the point of drawing.
  const [background, setBackground] = useState('')
  const [frameColor, setFrameColor] = useState(DEFAULT_FRAME_COLOR)
  const [frameMask, setFrameMask] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosingCharacter, setChoosingCharacter] = useState(false)

  const transform = useTokenTransform(DEFAULT_SIZE)
  // The pointer hook reads live scale/rotation for pinch gestures, so hand it
  // the current values alongside the dispatchers.
  const pointerActions = useMemo(
    () => ({
      ...transform,
      scale: transform.transform.scale,
      rotation: transform.transform.rotation,
    }),
    [transform]
  )

  const objectUrl = useRef(null)
  const releaseObjectUrl = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])
  useEffect(() => releaseObjectUrl, [releaseObjectUrl])

  useEffect(() => {
    let cancelled = false
    fetchFrames().then((rows) => {
      if (!cancelled) setFrames(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const applySource = useCallback(
    async (src) => {
      setError('')
      setLoadingSource(true)
      try {
        const loaded = await loadImage(src)
        setSource(loaded)
        transform.reset()
      } catch {
        setError(t('tokenEditor.loadFailed'))
        setSource(null)
      } finally {
        setLoadingSource(false)
      }
    },
    [t, transform]
  )

  // Opened from a token's detail page: that token is the starting art. The URL
  // is same-origin and authenticated by cookie, so the canvas stays untainted.
  useEffect(() => {
    if (!tokenId) return
    applySource(mediaUrl(`/tokens/${tokenId}/file`))
    // applySource is stable enough for this one-shot; re-running on every render
    // would refetch the image endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId])

  useEffect(() => {
    let cancelled = false
    if (!frameId) {
      setFrameImage(null)
      setFrameMask(null)
      return undefined
    }
    loadImage(frameUrl(frameId, frameColor))
      .then((loaded) => {
        if (cancelled) return
        setFrameImage(loaded.image)
        // Read the crop from the frame's own opening. Returns null for a frame
        // with no enclosed interior (a solid shape, or a border with a gap the
        // fill escapes through), in which case the geometric mask still applies.
        setFrameMask(frameApertureMask(loaded.image))
      })
      .catch(() => {
        if (cancelled) return
        setFrameImage(null)
        setFrameMask(null)
      })
    return () => {
      cancelled = true
    }
  }, [frameId, frameColor])

  const onFile = useCallback(
    (file) => {
      releaseObjectUrl()
      applySource(file)
    },
    [applySource, releaseObjectUrl]
  )

  const onPickSource = useCallback(
    ({ source_type: type, source_id: id }) => {
      // Maps and tokens have a full-resolution file; books and audio only ever
      // have a generated thumbnail, so fall back to that.
      const url =
        type === 'token' || type === 'map'
          ? mediaUrl(`/${type}s/${id}/file`)
          : imageSources.thumbUrl(type, id)
      if (url) applySource(url)
    },
    [applySource]
  )

  const spec = useMemo(
    () => ({
      source: source?.image || null,
      sourceWidth: source?.width,
      sourceHeight: source?.height,
      frame: frameImage,
      frameMask,
      size: transform.size,
      mask,
      // An empty value means transparent; anything else resolves through the
      // shared validator, so no unchecked string reaches the canvas.
      background: resolveIconColor(background, 'transparent'),
      transform: transform.transform,
    }),
    [source, frameImage, frameMask, transform.size, transform.transform, mask, background]
  )

  // A 140px source blown up to a 1024px token looks soft; say so rather than
  // letting the user discover it in their VTT.
  const sourceWarning =
    source && Math.min(source.width, source.height) < transform.size
      ? t('tokenEditor.lowResWarning', {
          width: source.width,
          height: source.height,
          size: transform.size,
        })
      : null

  const filename = useMemo(() => {
    const base = (target.memberName || t('tokenEditor.defaultName'))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return `${base || 'token'}-token.png`
  }, [target.memberName, t])

  const onDownload = async () => {
    if (!source || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await composeToBlob(spec)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || t('tokenEditor.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const saveAsArt = async ({ campaignId, memberId }) => {
    if (!source || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await composeToBlob(spec)
      const file = new File([blob], filename, { type: 'image/png' })
      await campaignsApi.uploadMemberArt(campaignId, memberId, file)
      setChoosingCharacter(false)
      navigate(`/campaigns/${campaignId}`, { state: { artUpdated: Date.now() } })
    } catch (err) {
      setError(err.message || t('tokenEditor.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onSetAsArt = () => {
    if (target.campaignId && target.memberId) {
      saveAsArt(target)
      return
    }
    setChoosingCharacter(true)
  }

  const canSave = !!source && !busy

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('common.back')}
          style={iconBtn}
        >
          <LuArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t('tokenEditor.title')}</h2>
        {target.memberName && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {t('tokenEditor.forCharacter', { name: target.memberName })}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          {loadingSource ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <Spinner size={28} />
            </div>
          ) : source ? (
            <TokenEditorCanvas spec={spec} actions={pointerActions} disabled={busy} />
          ) : (
            <TokenSourcePicker onFile={onFile} onPickSource={onPickSource} active={!busy} />
          )}

          {source && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" onClick={onDownload} disabled={!canSave} style={primaryBtn}>
                {busy ? <Spinner size={13} /> : <LuDownload size={14} aria-hidden="true" />}
                {t('tokenEditor.download')}
              </button>
              <button type="button" onClick={onSetAsArt} disabled={!canSave} style={secondaryBtn}>
                <LuUserRound size={14} aria-hidden="true" />
                {t('tokenEditor.setAsArt')}
              </button>
              <button
                type="button"
                onClick={() => {
                  releaseObjectUrl()
                  setSource(null)
                }}
                disabled={busy}
                style={secondaryBtn}
              >
                {t('tokenEditor.changeImage')}
              </button>
            </div>
          )}

          {error && (
            <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 260px', minWidth: 240 }}>
          <TokenEditorControls
            mask={mask}
            onMaskChange={setMask}
            size={transform.size}
            sizes={OUTPUT_SIZES}
            onSizeChange={transform.setSize}
            background={background}
            onBackgroundChange={setBackground}
            maskFromFrame={!!frameMask}
            frameColor={frameColor}
            onFrameColorChange={setFrameColor}
            frameRecolourable={frameIsRecolourable(frameId)}
            transform={transform.transform}
            actions={transform}
            disabled={!source || busy}
            sourceWarning={sourceWarning}
          />
          <FramePicker
            frames={frames}
            value={frameId}
            onChange={setFrameId}
            color={frameColor}
            loading={frames === null}
          />
        </div>
      </div>

      {choosingCharacter && (
        <SetAsArtDialog
          userId={user?.id}
          onClose={() => setChoosingCharacter(false)}
          onChoose={saveAsArt}
        />
      )}
    </div>
  )
}

const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}

// Matches the shared modal button shape used across the app (see `btn` in
// components/files/RenameModal.jsx) rather than inventing a local variant:
// solid gold for the primary action, bordered and transparent for the rest.
const baseBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
}

const primaryBtn = {
  ...baseBtn,
  background: 'var(--gold)',
  color: 'var(--on-accent)',
}

const secondaryBtn = {
  ...baseBtn,
  background: 'transparent',
  color: 'var(--text-dim)',
}

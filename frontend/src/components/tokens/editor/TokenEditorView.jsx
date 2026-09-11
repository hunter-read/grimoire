import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LuArrowLeft, LuDownload, LuUserRound } from 'react-icons/lu'

import { campaigns as campaignsApi, imageSources, mediaUrl } from '../../../api'
import { useAuth } from '../../../context/AuthContext'
import useIsMobile from '../../../hooks/useIsMobile'
import Spinner from '../../Spinner'
import { OUTPUT_SIZES, composeToBlob, loadImage } from '../../../lib/tokenCompositor'
import { frameApertureMask } from '../../../lib/frameMask'
import { resolveIconColor } from '../../campaigns/iconColors'
import FramePicker from './FramePicker'
import SendToCampaignDialog from './SendToCampaignDialog'
import TokenEditorCanvas from './TokenEditorCanvas'
import TokenEditorControls from './TokenEditorControls'
import TokenSourcePicker from './TokenSourcePicker'
import { fetchFrames, frameUrl } from './frames'
import { DEFAULT_FRAME_COLOR, genericShape } from './genericFrames'
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
  // Stacked on a narrow screen, the two columns cannot each own a slice of a
  // fixed viewport height — so the page scrolls as one instead, and the frame
  // list grows to its content rather than scrolling inside a squeezed box.
  const stacked = useIsMobile(760)

  // A member target arrives in router state rather than the URL: a membership id
  // in the address bar is noise, and state survives the back button.
  const target = location.state || {}

  const [source, setSource] = useState(null)
  const [loadingSource, setLoadingSource] = useState(!!tokenId)
  const [frames, setFrames] = useState(null)
  const [frameId, setFrameId] = useState(null)
  const [frameImage, setFrameImage] = useState(null)
  // Stored as an icon-colour token or "#rrggbb" (empty = transparent), the same
  // vocabulary campaign icons use, and resolved only at the point of drawing.
  const [background, setBackground] = useState('')
  // Empty means "no visible frame": the generic shapes then contribute only
  // their silhouette, which is what replaced the old separate Shape control.
  const [frameColor, setFrameColor] = useState(DEFAULT_FRAME_COLOR)
  const [frameMask, setFrameMask] = useState(null)
  // A generic shape with the colour cleared: crop to the silhouette, draw no
  // ring. This is what the old, redundant Shape segmented control did — the
  // frame list already offers a circle and a square, so having both was two
  // ways to say one thing.
  const shapeOnly = !frameColor
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosingDestination, setChoosingDestination] = useState(false)

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
    // A generic shape with no colour draws nothing — it exists only to say what
    // silhouette to crop to, which the geometric mask below already applies. So
    // there is no image to load, and no aperture to read from one.
    if (!frameId || (shapeOnly && genericShape(frameId))) {
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
  }, [frameId, frameColor, shapeOnly])

  const onFile = useCallback(
    (file) => {
      releaseObjectUrl()
      applySource(file)
    },
    [applySource, releaseObjectUrl]
  )

  const onPickSource = useCallback(
    ({ source_type: type, source_id: id }) => {
      // The picker only offers tokens, which have a full-resolution file. The
      // other branches are the safety net for any type a future caller might
      // pass: maps also have a real file, everything else only a thumbnail.
      const url =
        type === 'token' || type === 'map'
          ? mediaUrl(`/${type}s/${id}/file`)
          : imageSources.thumbUrl(type, id)
      if (url) applySource(url)
    },
    [applySource]
  )

  // The token's outline: a generic shape names its own mask, a frame with a
  // readable aperture supplies its own, and anything else is the full square.
  const mask = useMemo(() => {
    const shape = genericShape(frameId)
    if (shape) return shape
    return 'none'
  }, [frameId])

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

  /** Compose once and hand the PNG to `send`, then land on the campaign. */
  const deliver = async (campaignId, send) => {
    if (!source || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await composeToBlob(spec)
      const file = new File([blob], filename, { type: 'image/png' })
      await send(file)
      setChoosingDestination(false)
      navigate(`/campaigns/${campaignId}`, { state: { artUpdated: Date.now() } })
    } catch (err) {
      setError(err.message || t('tokenEditor.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const saveAsArt = ({ campaignId, memberId }) =>
    deliver(campaignId, (file) => campaignsApi.uploadMemberArt(campaignId, memberId, file))

  // A character's VTT token, stored beside their portrait rather than over it.
  const saveAsMemberToken = ({ campaignId, memberId }) =>
    deliver(campaignId, (file) => campaignsApi.uploadMemberToken(campaignId, memberId, file))

  // The GM path. `uploadImage` stores the PNG as a campaign file *and* links it
  // as a resource under the chosen category in one call — it is guarded by
  // `assert_can_manage`, which is exactly the "GM of this campaign" rule.
  const saveToCampaign = ({ campaignId, categoryId }) =>
    deliver(campaignId, (file) =>
      campaignsApi.uploadImage(campaignId, file, categoryId ? { categoryId } : {})
    )

  // Arriving from a member row pre-binds the target, which is the common path
  // and skips the chooser entirely.
  const onSetAsArt = () => {
    if (target.campaignId && target.memberId) {
      saveAsArt(target)
      return
    }
    setChoosingDestination(true)
  }

  const canSave = !!source && !busy

  return (
    // `main` is overflow:hidden for /tokens/* routes (see AppShell's isReader),
    // so this page gets the viewport height and must do its own scrolling —
    // without that the frame list is simply clipped at the window edge. minHeight
    // 0 is what lets the inner columns shrink and scroll rather than overflow.
    <div
      style={{
        padding: 20,
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...(stacked ? { overflowY: 'auto' } : null),
      }}
    >
      {/* flexShrink 0: the header must keep its height so the row below is the
          only thing that gives, otherwise the frame list's share of the
          viewport shrinks as the title wraps. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
          flexShrink: 0,
        }}
      >
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

      {/* Side by side on a wide screen, stacked on a narrow one. `flexWrap`
          stays off in the side-by-side case on purpose: a wrapping flex row is
          a *multi-line* container, so `stretch` gives its children no definite
          height and the frame list below cannot bound its own scroller. The
          `stacked` switch handles narrow screens instead of wrapping. */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          ...(stacked
            ? { flexDirection: 'column', alignItems: 'stretch' }
            : { alignItems: 'stretch', flex: 1, minHeight: 0 }),
        }}
      >
        <div
          style={{
            minWidth: 0,
            ...(stacked
              ? { flex: '0 0 auto' }
              : {
                  flex: '1 1 320px',
                  minHeight: 0,
                  // Before art is loaded the source picker fills this column and
                  // scrolls its own library list; afterwards the column scrolls
                  // normally around the canvas and its buttons.
                  ...(source || loadingSource
                    ? { overflowY: 'auto' }
                    : { display: 'flex', flexDirection: 'column' }),
                }),
          }}
        >
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
              {/* Arriving from a member row this really is "set as art"; opened
                  standalone it leads to the destination chooser, which offers
                  both the character-token and campaign-resource paths. */}
              <button type="button" onClick={onSetAsArt} disabled={!canSave} style={secondaryBtn}>
                <LuUserRound size={14} aria-hidden="true" />
                {target.campaignId && target.memberId
                  ? t('tokenEditor.setAsArt')
                  : t('tokenEditor.sendToCampaign')}
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

        {/* Wide enough for six frame tiles a row and for the control labels to
            sit beside their inputs rather than wrapping under them. It still
            gives way before the canvas does: `1 1 340px` on the canvas column
            means the canvas keeps the surplus, and both drop to full width when
            the row can no longer hold them side by side. */}
        <div
          style={{
            flex: stacked ? '0 0 auto' : '0 0 360px',
            minWidth: stacked ? 0 : 300,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {/* The controls keep their natural height; only the frame list below
              absorbs the leftover space and scrolls. */}
          <div style={{ flexShrink: 0 }}>
            <TokenEditorControls
              size={transform.size}
              sizes={OUTPUT_SIZES}
              onSizeChange={transform.setSize}
              background={background}
              onBackgroundChange={setBackground}
              transform={transform.transform}
              actions={transform}
              disabled={!source || busy}
              sourceWarning={sourceWarning}
            />
          </div>
          <FramePicker
            scroll={!stacked}
            frames={frames}
            value={frameId}
            onChange={setFrameId}
            color={frameColor}
            onColorChange={setFrameColor}
            loading={frames === null}
          />
        </div>
      </div>

      {choosingDestination && (
        <SendToCampaignDialog
          userId={user?.id}
          onClose={() => setChoosingDestination(false)}
          onChooseMember={saveAsMemberToken}
          onChooseCampaign={saveToCampaign}
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

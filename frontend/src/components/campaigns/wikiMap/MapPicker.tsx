import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuSearch, LuX } from 'react-icons/lu'
import { campaigns, type ApiError, type Schema } from '../../../api'
import Spinner from '../../Spinner'
import useDialogFocus from '../../../hooks/useDialogFocus'
import ImageUploadPanel from '../ImageUploadPanel'
import MapTile from './MapTile'
import { isImageMapName, mapThumbUrl, type MapChoice } from './mapPages'

export type { MapChoice }

interface MapPickerProps {
  campaignId: string
  /** The GM may link a library map or upload an image on the spot. */
  isOwner: boolean
  /** The map page's visibility, which a map linked from here follows. */
  pageVisibility?: string | null
  /** The choice, and its name to show until the page is saved. */
  onPick: (choice: MapChoice, name: string) => void
  onClose: () => void
}

/**
 * Choose the picture for a map page (issue #578).
 *
 * Lists the image maps linked to the campaign and its uploaded images - what
 * every member can already see - as tiles with each map's picture, since maps
 * are told apart by sight far more easily than by file name. The GM can also search the whole library,
 * which links the chosen map to the campaign first (so guests can open it),
 * or upload a new image.
 */
export default function MapPicker({
  campaignId,
  isOwner,
  pageVisibility,
  onPick,
  onClose,
}: MapPickerProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, { onClose })
  const [linked, setLinked] = useState<Schema<'LinkedResourceOut'>[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Schema<'ResourceSearchHit'>[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    campaigns
      .listResources(campaignId)
      .then((list) => setLinked(list || []))
      .catch(() => setLinked([]))
  }, [campaignId])

  // Library search, for the GM. Debounced so typing doesn't fire a request a
  // keystroke.
  useEffect(() => {
    if (!isOwner) return
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    let active = true
    const timer = setTimeout(() => {
      campaigns
        .searchResources(q, 'map', '', 50)
        .then((list) => {
          if (active) setHits((list || []).filter((h) => isImageMapName(h.name)))
        })
        .catch(() => active && setHits([]))
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [isOwner, query])

  const choices = (linked || []).filter(
    (r) =>
      (r.resource_type === 'map' && isImageMapName(r.name)) ||
      (r.resource_type === 'file' && r.is_image)
  )
  const linkedMapIds = new Set(
    choices.filter((r) => r.resource_type === 'map').map((r) => r.resource_id)
  )

  const pickLinked = (r: Schema<'LinkedResourceOut'>) =>
    onPick(
      r.resource_type === 'map' ? { map_id: r.resource_id } : { map_file_id: r.resource_id },
      r.name
    )

  const pickFromLibrary = async (hit: Schema<'ResourceSearchHit'>) => {
    setError(null)
    try {
      if (!linkedMapIds.has(hit.resource_id)) {
        // Seen by whoever the page is shown to: a public page links it public.
        await campaigns.addResource(campaignId, {
          resource_type: 'map',
          resource_id: hit.resource_id,
          visibility: pageVisibility === 'group' ? 'public' : 'gm',
        })
      }
      onPick({ map_id: hit.resource_id }, hit.name)
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  return (
    <div style={backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-map-picker-title"
        style={panel}
      >
        <button onClick={onClose} aria-label={t('common.close')} style={closeBtn}>
          <LuX size={18} />
        </button>
        <h2
          id="wiki-map-picker-title"
          style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}
        >
          {t('wikiMap.chooseMap')}
        </h2>

        {uploading ? (
          <ImageUploadPanel
            campaignId={campaignId}
            onUploaded={(created) => onPick({ map_file_id: created.resource_id }, created.name)}
            onCancel={() => setUploading(false)}
          />
        ) : (
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            <h3 style={sectionLabel}>{t('wikiMap.inThisCampaign')}</h3>
            {linked === null ? (
              <Spinner size={18} />
            ) : choices.length === 0 ? (
              <p style={empty}>
                {isOwner ? t('wikiMap.noLinkedMapsGm') : t('wikiMap.noLinkedMaps')}
              </p>
            ) : (
              <ul role="list" style={grid}>
                {choices.map((r) => {
                  const isMap = r.resource_type === 'map'
                  return (
                    <li key={r.id}>
                      <MapTile
                        name={r.name}
                        kind={isMap ? 'map' : 'file'}
                        src={mapThumbUrl(
                          campaignId,
                          isMap ? 'library' : 'file',
                          r.resource_id,
                          r.has_thumbnail
                        )}
                        onClick={() => pickLinked(r)}
                      />
                    </li>
                  )
                })}
              </ul>
            )}

            {isOwner && (
              <>
                <h3 style={{ ...sectionLabel, marginTop: 16 }}>{t('wikiMap.fromLibrary')}</h3>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <LuSearch size={13} style={searchIcon} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('wikiMap.searchLibrary')}
                    aria-label={t('wikiMap.searchLibrary')}
                    style={searchInput}
                  />
                </div>
                {hits && hits.length === 0 && <p style={empty}>{t('wikiMap.noLibraryMatches')}</p>}
                {hits && hits.length > 0 && (
                  <ul role="list" style={grid}>
                    {hits.map((h) => (
                      <li key={h.resource_id}>
                        <MapTile
                          name={h.name}
                          subtitle={h.subtitle}
                          kind="map"
                          src={mapThumbUrl(campaignId, 'library', h.resource_id, h.has_thumbnail)}
                          onClick={() => void pickFromLibrary(h)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setUploading(true)}
                  style={{ ...row, marginTop: 12, justifyContent: 'center' }}
                >
                  <LuPlus size={14} aria-hidden="true" /> {t('wikiMap.uploadImage')}
                </button>
              </>
            )}
            {error && (
              <p role="alert" style={{ ...empty, color: 'var(--danger)' }}>
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim-strong)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const panel: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 24,
  width: '100%',
  // Wide enough for three or four map tiles a row.
  maxWidth: 640,
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
}

const closeBtn: CSSProperties = {
  position: 'absolute',
  top: 14,
  right: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

const sectionLabel: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  margin: '0 0 6px',
}

const grid: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 8,
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'left',
}

const empty: CSSProperties = { fontSize: 13, color: 'var(--text-muted)', margin: '4px 0' }

const searchIcon: CSSProperties = {
  position: 'absolute',
  left: 9,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--text-muted)',
}

const searchInput: CSSProperties = {
  width: '100%',
  padding: '6px 8px 6px 28px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-control)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
}

import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuEyeOff, LuMap, LuMapPin, LuMapPinned, LuPencil, LuPlus, LuReplace } from 'react-icons/lu'
import { campaigns, type ApiError, type Schema } from '../../../api'
import { CampaignIcon } from '../campaignIcons'
import { resolveIconColor } from '../iconColors'
import { ghostBtn } from '../wikiShared'
import MapPicker, { type MapChoice } from './MapPicker'
import PinEditor from './PinEditor'
import WikiMapCanvas from './WikiMapCanvas'
import { mapImageUrl, pinName, type WikiPin } from './mapPages'

type PageDetail = Schema<'WikiPageDetailOut'>

interface WikiMapViewProps {
  campaignId: string
  page: PageDetail
  /** The wiki's pages this user can see, for linking pins. */
  pages: Pick<Schema<'WikiPageListItem'>, 'id' | 'title'>[]
  isGm: boolean
  noteHref: (pageId: string) => string
  /** The page itself changed (a new map) - reload it. */
  onPageChanged: () => void
  /** A pin created a page - refresh the page list. */
  onPagesChanged: () => void
}

/** Where a new pin will go, before it is saved. */
type Draft = { x: number; y: number }

/**
 * The map half of a map page (issue #578): the picture with its pins, a list of
 * the same pins for keyboard and screen-reader users, and - for those who may
 * edit the page - placing, moving and editing pins.
 *
 * A page whose map has left the library, or that has none yet, shows a
 * placeholder with Replace map instead. Its pins are kept and listed, so
 * choosing another copy of the map puts them all back.
 */
export default function WikiMapView({
  campaignId,
  page,
  pages,
  isGm,
  noteHref,
  onPageChanged,
  onPagesChanged,
}: WikiMapViewProps) {
  const { t } = useTranslation()
  const [pins, setPins] = useState<WikiPin[]>(page.pins ?? [])
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setPins(page.pins ?? [])
    setSelectedId(null)
    setDraft(null)
  }, [page.id, page.pins])

  const canEdit = page.can_edit
  const map = page.map
  const src = mapImageUrl(campaignId, map)
  const selected = pins.find((p) => p.id === selectedId) ?? null
  const hrefFor = (pin: WikiPin) => (pin.target_page_id ? noteHref(pin.target_page_id) : null)

  const closeEditor = () => {
    setSelectedId(null)
    setDraft(null)
    setError(null)
  }

  const replacePin = (saved: WikiPin) =>
    setPins((list) => {
      const i = list.findIndex((p) => p.id === saved.id)
      return i === -1 ? [...list, saved] : list.map((p) => (p.id === saved.id ? saved : p))
    })

  const savePin = async (payload: Schema<'WikiMapPinUpdate'>) => {
    setSaving(true)
    setError(null)
    try {
      const createsPage = !!payload.target_title
      const saved = draft
        ? await campaigns.createWikiPin(campaignId, page.id, {
            ...payload,
            label: payload.label ?? '',
            visibility: payload.visibility ?? 'page',
            ...draft,
          })
        : await campaigns.updateWikiPin(campaignId, page.id, selectedId!, payload)
      replacePin(saved)
      setStatus(t(draft ? 'wikiMap.pinAdded' : 'wikiMap.pinSaved', { name: pinName(saved) }))
      closeEditor()
      if (createsPage) onPagesChanged()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  const deletePin = async () => {
    if (!selected) return
    try {
      await campaigns.deleteWikiPin(campaignId, page.id, selected.id)
    } catch (e) {
      setError((e as ApiError).message)
      return
    }
    setPins((list) => list.filter((p) => p.id !== selected.id))
    setStatus(t('wikiMap.pinDeleted', { name: pinName(selected) }))
    closeEditor()
  }

  const movePin = async (id: string, x: number, y: number) => {
    const before = pins.find((p) => p.id === id)
    if (!before || (before.x === x && before.y === y)) return
    // Shown where it was dropped straight away, put back if the save fails.
    setPins((list) => list.map((p) => (p.id === id ? { ...p, x, y } : p)))
    try {
      replacePin(await campaigns.updateWikiPin(campaignId, page.id, id, { x, y }))
      setStatus(t('wikiMap.pinMoved', { name: pinName(before) }))
    } catch (e) {
      replacePin(before)
      setError((e as ApiError).message)
    }
  }

  const pickMap = async (choice: MapChoice) => {
    setPicking(false)
    try {
      await campaigns.updateWikiPage(campaignId, page.id, choice)
      onPageChanged()
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  const startAdd = (x = 0.5, y = 0.5) => {
    setSelectedId(null)
    setError(null)
    setDraft({ x, y })
  }

  const editorOpen = editing && (draft !== null || selected !== null)

  return (
    <section aria-label={t('wikiMap.mapRegion')} style={{ marginBottom: 16 }}>
      <div role="status" className="sr-only">
        {status}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {src && (
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v)
                closeEditor()
              }}
              aria-pressed={editing}
              style={
                editing
                  ? { ...ghostBtn, borderColor: 'var(--gold)', color: 'var(--gold)' }
                  : ghostBtn
              }
            >
              <LuMapPinned size={13} aria-hidden="true" /> {t('wikiMap.editPins')}
            </button>
          )}
          {editing && (
            <button type="button" onClick={() => startAdd()} style={ghostBtn}>
              <LuPlus size={13} aria-hidden="true" /> {t('wikiMap.addPin')}
            </button>
          )}
          {src && (
            <button type="button" onClick={() => setPicking(true)} style={ghostBtn}>
              <LuReplace size={13} aria-hidden="true" /> {t('wikiMap.replaceMap')}
            </button>
          )}
        </div>
      )}

      {editing && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          {t('wikiMap.editHint')}
        </p>
      )}

      {src ? (
        <WikiMapCanvas
          src={src}
          alt={map?.name || page.title}
          pins={draft ? [...pins, draftPin(draft)] : pins}
          editing={editing}
          selectedPinId={draft ? DRAFT_ID : selectedId}
          hrefFor={hrefFor}
          onSelectPin={(id) => {
            if (id === DRAFT_ID) return
            setDraft(null)
            setSelectedId(id)
          }}
          onAddPin={startAdd}
          onMovePin={(id, x, y) => {
            if (id === DRAFT_ID) setDraft({ x, y })
            else void movePin(id, x, y)
          }}
        />
      ) : (
        <div style={placeholder}>
          <LuMap size={28} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          <p style={{ margin: 0, fontSize: 14 }}>
            {map?.source === 'missing' ? t('wikiMap.missing') : t('wikiMap.noMap')}
          </p>
          {map?.source === 'missing' && pins.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('wikiMap.pinsKept', { count: pins.length })}
            </p>
          )}
          {canEdit && (
            <button type="button" onClick={() => setPicking(true)} style={ghostBtn}>
              <LuReplace size={13} aria-hidden="true" />{' '}
              {map?.source === 'missing' ? t('wikiMap.replaceMap') : t('wikiMap.chooseMap')}
            </button>
          )}
        </div>
      )}

      {error && !editorOpen && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>
          {error}
        </p>
      )}

      {editorOpen && (
        <div style={{ marginTop: 12 }}>
          <PinEditor
            key={draft ? 'new' : selectedId}
            pin={draft ? null : selected}
            pages={pages}
            mapPageId={page.id}
            isGm={isGm}
            saving={saving}
            error={error}
            onSave={(payload) => void savePin(payload)}
            onDelete={draft ? undefined : () => void deletePin()}
            onCancel={closeEditor}
          />
        </div>
      )}

      {pins.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3 style={listHeading}>
            <LuMapPin size={13} aria-hidden="true" /> {t('wikiMap.locations')}
          </h3>
          <ul role="list" style={pinList}>
            {pins.map((pin) => (
              <li key={pin.id} style={pinRow}>
                <CampaignIcon
                  name={pin.icon || pin.target_icon}
                  fallback={LuMapPin}
                  size={14}
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    color: resolveIconColor(pin.icon ? pin.icon_color : pin.target_icon_color),
                  }}
                />
                {pin.target_page_id ? (
                  <Link to={noteHref(pin.target_page_id)} replace style={pinLink}>
                    {pinName(pin)}
                  </Link>
                ) : (
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {pinName(pin) || t('wikiMap.unnamedPin')}{' '}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      ({t('wikiMap.unlinked')})
                    </span>
                  </span>
                )}
                {pin.target_title && pin.label && pin.label !== pin.target_title && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {pin.target_title}
                  </span>
                )}
                {pin.visibility === 'gm' && (
                  <span style={gmBadge}>
                    <LuEyeOff size={11} aria-hidden="true" /> {t('wikiMap.gmOnly')}
                  </span>
                )}
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null)
                      setSelectedId(pin.id)
                    }}
                    aria-label={t('wikiMap.editPinNamed', {
                      name: pinName(pin) || t('wikiMap.unnamedPin'),
                    })}
                    style={{ ...ghostBtn, padding: '4px 8px' }}
                  >
                    <LuPencil size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {picking && (
        <MapPicker
          campaignId={campaignId}
          isOwner={isGm}
          pageVisibility={page.visibility}
          onPick={(choice) => void pickMap(choice)}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  )
}

// The not-yet-saved pin a click on the map places, drawn like any other.
const DRAFT_ID = '__new_pin__'
const draftPin = (at: Draft): WikiPin => ({
  id: DRAFT_ID,
  x: at.x,
  y: at.y,
  label: '',
  visibility: 'page',
  sort_order: 0,
  can_edit: true,
})

const placeholder: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: 220,
  padding: 24,
  textAlign: 'center',
  background: 'var(--bg-deep)',
  border: '1px dashed var(--border)',
  borderRadius: 12,
  color: 'var(--text-dim)',
}

const listHeading: CSSProperties = {
  fontSize: 12,
  fontFamily: 'inherit',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  margin: '0 0 8px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const pinList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const pinRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 13,
}

const pinLink: CSSProperties = {
  flex: 1,
  minWidth: 0,
  color: 'var(--text)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--border)',
  textUnderlineOffset: 3,
}

const gmBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  fontSize: 11,
  color: 'var(--text-dim)',
}

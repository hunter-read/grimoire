import { useId, useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuMapPin, LuTrash2 } from 'react-icons/lu'
import type { Schema } from '../../../api'
import IconPicker from '../IconPicker'
import { ghostBtn, goldBtn } from '../wikiShared'
import type { WikiPin } from './mapPages'

type PinPayload = Schema<'WikiMapPinUpdate'>

interface PinEditorProps {
  /** The pin being edited, or null for a new one. */
  pin: WikiPin | null
  /** The wiki's pages this user can see, for the page a pin links to. */
  pages: Pick<Schema<'WikiPageListItem'>, 'id' | 'title'>[]
  /** The map page itself, which a pin can't link to. */
  mapPageId: string
  isGm: boolean
  saving?: boolean
  error?: string | null
  onSave: (payload: PinPayload) => void
  onDelete?: () => void
  onCancel: () => void
}

/**
 * The form for one pin: its name, the page it opens, its icon, and - for the
 * GM - whether players see it.
 *
 * The page is typed as a title, with the wiki's own pages offered as you type.
 * A title naming no page creates one, the way a `[[Page Title]]` link does; an
 * empty one leaves the pin unlinked.
 */
export default function PinEditor({
  pin,
  pages,
  mapPageId,
  isGm,
  saving = false,
  error,
  onSave,
  onDelete,
  onCancel,
}: PinEditorProps) {
  const { t } = useTranslation()
  const ids = useId()
  const [label, setLabel] = useState(pin?.label ?? '')
  const [target, setTarget] = useState(pin?.target_title ?? '')
  const [icon, setIcon] = useState(pin?.icon ?? '')
  const [iconColor, setIconColor] = useState(pin?.icon_color ?? '')
  const [gmOnly, setGmOnly] = useState(pin?.visibility === 'gm')

  const candidates = pages.filter((p) => p.id !== mapPageId)
  const typed = target.trim()
  const match = typed
    ? candidates.find((p) => p.title.trim().toLowerCase() === typed.toLowerCase())
    : undefined
  const createsPage = !!typed && !match

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const payload: PinPayload = {
      label: label.trim(),
      icon: icon || '',
      icon_color: iconColor || '',
    }
    if (match) payload.target_page_id = match.id
    else if (typed) payload.target_title = typed
    else payload.target_page_id = ''
    if (isGm) payload.visibility = gmOnly ? 'gm' : 'page'
    onSave(payload)
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${ids}-title`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <h3
        id={`${ids}-title`}
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <LuMapPin size={14} aria-hidden="true" /> {pin ? t('wikiMap.editPin') : t('wikiMap.newPin')}
      </h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <IconPicker
          value={icon}
          onChange={setIcon}
          color={iconColor}
          onColorChange={setIconColor}
          fallback={<LuMapPin size={14} aria-hidden="true" />}
          ariaLabel={t('wikiMap.pinIcon')}
        />
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={fieldLabel}>{t('wikiMap.pinLabel')}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={255}
            placeholder={t('wikiMap.pinLabelPlaceholder')}
            autoFocus
            style={input}
          />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor={`${ids}-target`} style={fieldLabel}>
          {t('wikiMap.pinTarget')}
        </label>
        <input
          id={`${ids}-target`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          list={`${ids}-pages`}
          maxLength={255}
          placeholder={t('wikiMap.pinTargetPlaceholder')}
          aria-describedby={`${ids}-target-hint`}
          style={input}
        />
        <datalist id={`${ids}-pages`}>
          {candidates.map((p) => (
            <option key={p.id} value={p.title} />
          ))}
        </datalist>
        <span id={`${ids}-target-hint`} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {createsPage
            ? t('wikiMap.pinTargetCreates', { title: typed })
            : typed
              ? t('wikiMap.pinTargetLinks')
              : t('wikiMap.pinTargetNone')}
        </span>
      </div>
      {isGm && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={gmOnly} onChange={(e) => setGmOnly(e.target.checked)} />
          {t('wikiMap.pinGmOnly')}
        </label>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" disabled={saving} style={goldBtn}>
          {saving ? t('wiki.saving') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          {t('common.cancel')}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            style={{ ...ghostBtn, marginLeft: 'auto', color: 'var(--danger)' }}
          >
            <LuTrash2 size={13} aria-hidden="true" /> {t('wikiMap.deletePin')}
          </button>
        )}
      </div>
    </form>
  )
}

const fieldLabel: CSSProperties = { fontSize: 12, color: 'var(--text-muted)' }

const input: CSSProperties = {
  padding: '7px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-control)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
}

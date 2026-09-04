import { useTranslation } from 'react-i18next'
import {
  LuContrast,
  LuFileText,
  LuGrid3X3,
  LuImage,
  LuLayers,
  LuPalette,
  LuPrinter,
  LuRewind,
  LuFastForward,
  LuShuffle,
  LuSlash,
  LuSquareStack,
  LuVideo,
  LuFileCode,
} from 'react-icons/lu'

// How many icons a card shows before collapsing the rest into "+N". Two covers
// the pairs this exists for (a still map beside its Universal VTT and its
// animated cut) without crowding a compact card's footer.
const MAX_KIND_ICONS = 2

// One icon per variant kind, covering the vocabulary in models/variants.py.
// A kind with no entry here (or one added to the backend later) falls back to
// the generic stack icon rather than rendering nothing.
const KIND_ICON = {
  'universal-vtt': LuFileCode,
  video: LuVideo,
  image: LuImage,
  gridded: LuGrid3X3,
  gridless: LuSlash,
  'printer-friendly': LuPrinter,
  'form-fillable': LuFileText,
  'black-and-white': LuContrast,
  'color-variation': LuPalette,
  spreads: LuSquareStack,
  'single-page': LuFileText,
  remix: LuShuffle,
  slowed: LuRewind,
  'sped-up': LuFastForward,
  version: LuLayers,
  other: LuLayers,
}

/**
 * The "other versions" badge, shown in the card footer beside the file size.
 *
 * Icons rather than text: what the user is scanning a gallery for is whether the
 * VTT export or the animated cut exists, and at a glance a shape answers that
 * faster than a word — while staying out of the way of the filename on a compact
 * card. Each icon keeps its translated name as its accessible label and tooltip,
 * so nothing is lost for a screen reader or an unfamiliar glyph.
 *
 * The icons keep the themed `--variant` accent that marks versions everywhere
 * else in the app (the picker, the book rows, the duplicate compare view). As a
 * filled chip that accent was a distracting block of colour next to the artwork;
 * at glyph size it is a small tint that ties the badge to the rest of the
 * feature. The bare count fallback has no such shape to carry colour, so it
 * stays muted like the file size beside it.
 *
 * `variant_kinds` is filled by the list endpoints from one grouped query per
 * page, so this costs no extra request; it is empty for variants linked without
 * a kind, and the count carries those.
 */
export default function VariantBadge({ item }) {
  const { t } = useTranslation()
  const kinds = item.variant_kinds || []
  const style = { display: 'inline-flex', alignItems: 'center', color: 'var(--variant)' }

  if (!kinds.length) {
    const label = t('variants.badge', { count: item.variant_count + 1 })
    return (
      <span
        style={{ ...style, color: 'var(--text-muted)', gap: 3 }}
        title={label}
        aria-label={label}
      >
        <LuLayers size={13} aria-hidden="true" />
        <span aria-hidden="true">{item.variant_count + 1}</span>
      </span>
    )
  }

  const shown = kinds.slice(0, MAX_KIND_ICONS)
  const extra = kinds.length - shown.length
  return (
    <>
      {shown.map((k) => {
        const Icon = KIND_ICON[k] || LuLayers
        const label = t(`variants.kind.${k}`, { defaultValue: k })
        return (
          <span key={k} style={style} title={label}>
            <Icon size={13} role="img" aria-label={label} />
          </span>
        )
      })}
      {extra > 0 && <span style={{ ...style, color: 'var(--text-muted)' }}>+{extra}</span>}
    </>
  )
}

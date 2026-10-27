/**
 * How one version is named in a picker.
 *
 * The two pickers on a detail page — the header switcher and the Download menu —
 * label the same family, so the rule lives here rather than being written twice
 * and drifting apart.
 *
 * A version carries two independent pieces of description: its *kind* (a closed
 * vocabulary — gridded, printer-friendly, video) and a free-text *label* the
 * user typed ("v1.2", "night lighting"). Showing only one of them loses
 * information a family often needs to be told apart: two gridded cuts of the
 * same map differ solely by their labels, and a bare "v1.2" does not say what
 * kind of file it is. Both are shown, kind first.
 *
 * `version` and `other` are the exception. They are the two kinds that say
 * nothing — "Version" as an entry in a list of versions is noise — so when one
 * of them carries no label there is nothing left to name it by, and the filename
 * is the only thing that can tell the user which file they are about to open.
 */
import type { Translate } from '../i18n'

const GENERIC_KINDS = new Set(['version', 'other'])

/** One entry in a version picker. */
export interface VariantOption {
  id?: string
  isMain?: boolean
  kind?: string | null
  label?: string | null
  filename?: string | null
}

/** The main entry `mainOption` builds. */
export interface MainVariantOption {
  id: string
  isMain: true
  kind: string
  label: string
  filename?: string
}

/** The family fields `mainOption` reads from a detail response. */
export interface VariantFamilyItem {
  id?: string | null
  filename?: string | null
  variant_main_id?: string | null
  variant_main_kind?: string | null
  variant_main_label?: string | null
  variant_main_filename?: string | null
}

/**
 * The name of one version: kind, label, or both.
 *
 * @param {object} option one version: `{ isMain, kind, label, filename }`. A main
 *   version's kind and label are optional; without them it is "Main version".
 * @param {Function} t i18next translate
 * @returns {string} the text for this row
 */
export default function variantLabel(option: VariantOption, t: Translate): string {
  // A label that is just the filename is not a description of anything - it is
  // what the linker filled in when it had nothing better, and the indexer does
  // exactly that for an auto-detected pair. Treating it as a real label prints
  // the filename inside the name *and* again underneath it.
  const label = labelText(option)
  const kind = option.kind || ''
  const generic = !kind || GENERIC_KINDS.has(kind)

  // The main version names itself the same way once it has been described (a
  // map pack's main is often the gridless cut - issue #556). Undescribed, it is
  // "Main version" rather than its filename: that is still the most useful
  // thing to say about the copy every other entry is a version *of*.
  if (option.isMain && generic && !label) return t('variants.mainVersion')

  // Nothing describes this one: fall back to the filename, which at least
  // distinguishes it from its siblings.
  if (generic && !label) return option.filename || t(`variants.kind.${kind || 'other'}`)

  // A generic kind adds nothing next to a real label, so the label stands alone.
  if (generic) return label

  const kindText = t(`variants.kind.${kind}`, { defaultValue: kind })
  return label ? `${kindText} · ${label}` : kindText
}

/**
 * The free-text label, ignoring one that only repeats the filename.
 *
 * Kept separate so `variantFilename` can ask the same question without
 * re-deriving it from the composed name.
 */
function labelText(option: VariantOption): string {
  const label = (option.label || '').trim()
  if (!label) return ''
  return label === (option.filename || '').trim() ? '' : label
}

/**
 * The filename, when it is worth showing *underneath* the name above.
 *
 * "Gridded · v1.2" says what the version is for, but not which file it is, and
 * on a download menu that is the thing the user is about to commit to. Returns
 * empty when the name above already carries the filename - either because it
 * *is* the filename, or because the label repeated it - and when there is no
 * filename at all, so callers can render it unconditionally.
 *
 * @param {object} option one version
 * @param {Function} t i18next translate
 * @returns {string} the filename, or '' when it would be redundant
 */
export function variantFilename(option: VariantOption, t: Translate): string {
  const filename = (option.filename || '').trim()
  if (!filename) return ''
  return variantLabel(option, t).includes(filename) ? '' : filename
}

/**
 * The main entry of a family's picker, built from a detail response.
 *
 * The response may be for any member of the family, so the main's name and
 * filename come from the `variant_main_*` fields rather than from the row
 * itself - which, for a variant, describes the variant.
 *
 * @param {object} item a detail response carrying the family
 * @param {string} [fallbackId] id to use when the response has none
 * @returns {object} `{ id, isMain, kind, label, filename }`
 */
export function mainOption(item: VariantFamilyItem, fallbackId?: string): MainVariantOption {
  return {
    // A detail response always carries its own id; `fallbackId` covers the rest.
    id: (item.variant_main_id || item.id || fallbackId) as string,
    isMain: true,
    kind: item.variant_main_kind || '',
    label: item.variant_main_label || '',
    filename: (item.variant_main_filename || item.filename) as string | undefined,
  }
}

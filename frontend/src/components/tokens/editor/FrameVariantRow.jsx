import { useTranslation } from 'react-i18next'

import variantLabel from '../../../utils/variantLabel'
import FrameTile from './FrameTile'
import { frameUrl } from './frames'

/**
 * The versions of the selected frame, shown in the slot the colour row uses.
 *
 * A frame folder often holds the same ring more than once — a black-and-white
 * cut beside the colour original, a thinner weight, a recoloured set. Marked as
 * versions of one another in the duplicates review, they collapse to one tile in
 * the gallery; this row is where the other cuts stay reachable.
 *
 * It occupies the colour row's slot deliberately. The two are alternatives, not
 * companions: a library frame is a file and takes no colour, so the space that
 * would hold swatches for a generic shape holds versions for a library frame,
 * and the panel below never shifts as the selection moves.
 *
 * The main version leads the row, so switching away from a version and back is
 * one click rather than a hunt through the gallery for the tile you started on.
 */
export default function FrameVariantRow({ frame, value, onChange, hoverProps }) {
  const { t } = useTranslation()
  const variants = frame?.variants || []
  if (!frame || variants.length === 0) return null

  const entries = [frame, ...variants]

  return (
    <div>
      <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>
        {t('tokenEditor.frameVersions')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {entries.map((entry, index) => {
          // The shared version-naming rule, so a frame's versions read exactly
          // as a book's or a map's do: kind and label together, the filename
          // when neither says anything. `isMain` names the frame itself, which
          // carries no kind of its own — it is what the others are versions *of*.
          const label = variantLabel(
            {
              isMain: index === 0,
              kind: entry.variant_kind,
              label: entry.variant_label,
              filename: entry.name,
            },
            t
          )
          return (
            <FrameTile
              key={entry.id}
              size={38}
              selected={value === entry.id}
              label={label}
              onClick={() => onChange(entry.id)}
              {...(hoverProps ? hoverProps(entry, label) : {})}
            >
              <img
                src={frameUrl(entry)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </FrameTile>
          )
        })}
      </div>
    </div>
  )
}

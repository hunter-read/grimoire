import { useTranslation } from 'react-i18next'
import { LuGrid2X2Plus, LuGrid2X2Check } from 'react-icons/lu'
import { useSoundboard } from '../../context/SoundboardContext'

/**
 * "Add to soundboard" for a single track, sitting alongside the queue's
 * "Play next" so a file can go to either destination from the same place.
 *
 * Already-added tracks show a checked icon and the button becomes a no-op
 * rather than disappearing, so the control doesn't shift position on click.
 */
export default function AddToSoundboardButton({ track, size = 30 }) {
  const { t } = useTranslation()
  const { addPads, hasPad } = useSoundboard()

  if (!track || !track.id) return null

  const added = hasPad(track.id)
  const label = added ? t('soundboard.added') : t('soundboard.add')

  const onClick = (e) => {
    e.stopPropagation()
    if (!added) addPads(track)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={added}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: added ? 'var(--gold)' : 'var(--text-dim)',
        cursor: added ? 'default' : 'pointer',
        flexShrink: 0,
      }}
    >
      {added ? <LuGrid2X2Check size={size / 2} /> : <LuGrid2X2Plus size={size / 2} />}
    </button>
  )
}

import { useTranslation } from 'react-i18next'
import { LuGrid2X2 } from 'react-icons/lu'
import { useSoundboard } from '../../context/SoundboardContext'

const MARGIN = 16

/**
 * The closed-state handle for the soundboard: a small floating button in the
 * bottom-right corner that opens the panel again.
 *
 * Only shown once the board has pads — an empty board has nothing to reopen, so
 * the corner stays clear until the user adds their first sound.
 */
export default function SoundboardLauncher({ bottomOffset = 0 }) {
  const { t } = useTranslation()
  const { pads, open, setOpen } = useSoundboard()

  if (open || pads.length === 0) return null

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('soundboard.open')}
      title={t('soundboard.open')}
      style={{
        position: 'fixed',
        right: MARGIN,
        bottom: bottomOffset + MARGIN,
        zIndex: 96,
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        color: 'var(--text-dim)',
        boxShadow: '0 4px 14px var(--shadow)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LuGrid2X2 size={18} />
    </button>
  )
}

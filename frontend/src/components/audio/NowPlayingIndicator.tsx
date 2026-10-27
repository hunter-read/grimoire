import { useTranslation } from 'react-i18next'

// Per-bar animation timings. Staggered durations/delays keep the three bars out
// of sync so the motif reads as an equalizer rather than a single pulsing block.
const BARS = [
  { duration: '0.9s', delay: '0s', restHeight: '55%' },
  { duration: '0.7s', delay: '-0.35s', restHeight: '90%' },
  { duration: '1.1s', delay: '-0.65s', restHeight: '40%' },
]

/**
 * The animated 3-bar "now playing" equalizer motif.
 *
 * Purely presentational — it reflects playback state, it does not react to the
 * actual audio signal. `playing` drives the animation: a current-but-paused
 * track keeps the bars visible (so the row stays findable) but freezes them.
 *
 * Under `prefers-reduced-motion` the animation is suppressed via CSS and the
 * bars render as static staggered ticks, per the media query below.
 */
export default function NowPlayingIndicator({ playing = true, size = 14, color = 'var(--gold)' }) {
  const { t } = useTranslation()

  return (
    <span
      role="img"
      aria-label={playing ? t('audio.nowPlaying') : t('audio.nowPlayingPaused')}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: Math.max(1, Math.round(size * 0.14)),
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={playing ? 'grimoire-eq-bar' : undefined}
          style={{
            display: 'block',
            width: Math.max(2, Math.round(size * 0.2)),
            height: bar.restHeight,
            borderRadius: 1,
            background: color,
            animationDuration: bar.duration,
            animationDelay: bar.delay,
          }}
        />
      ))}
      <style>{`
        .grimoire-eq-bar {
          animation-name: grimoire-eq-bounce;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          transform-origin: bottom;
        }
        @keyframes grimoire-eq-bounce {
          0%, 100% { height: 30%; }
          50%      { height: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .grimoire-eq-bar { animation: none; }
        }
      `}</style>
    </span>
  )
}

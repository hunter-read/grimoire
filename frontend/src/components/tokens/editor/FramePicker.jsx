import { useTranslation } from 'react-i18next'
import { LuBan } from 'react-icons/lu'

import FrameTile from './FrameTile'
import { frameLabel, frameUrl, groupFrames } from './frames'

/**
 * The frame gallery.
 *
 * Tiles sit on a checkerboard rather than the panel colour: a gold ring on a
 * dark panel and the same ring on white read completely differently, and the
 * checkerboard also says "the middle of this is transparent" without a caption.
 */

export default function FramePicker({ frames, value, onChange, color, loading = false }) {
  const { t } = useTranslation()
  const groups = groupFrames(frames || [])

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('tokenEditor.frame')}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <FrameTile
          selected={!value}
          label={t('tokenEditor.noFrame')}
          onClick={() => onChange(null)}
        >
          <LuBan size={18} aria-hidden="true" />
        </FrameTile>
        {groups
          .filter((g) => g.builtin)
          .flatMap((g) => g.frames)
          .map((frame) => (
            <FrameTile
              key={frame.id}
              selected={value === frame.id}
              label={frameLabel(frame, t)}
              onClick={() => onChange(frame.id)}
            >
              <img
                src={frameUrl(frame, color)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </FrameTile>
          ))}
      </div>

      {groups
        .filter((g) => !g.builtin)
        .map((group) => (
          <div key={group.key} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {group.label || t('tokenEditor.libraryFrames')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {group.frames.map((frame) => (
                <FrameTile
                  key={frame.id}
                  selected={value === frame.id}
                  label={frameLabel(frame, t)}
                  onClick={() => onChange(frame.id)}
                >
                  <img
                    src={frameUrl(frame, color)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </FrameTile>
              ))}
            </div>
          </div>
        ))}

      {!loading && groups.every((g) => g.builtin) && (
        <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, margin: 0 }}>
          {t('tokenEditor.customFramesHint')}
        </p>
      )}
    </div>
  )
}

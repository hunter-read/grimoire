import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { goldBtn, ghostBtn, scrim, card, helpText } from './characterStyles'

/**
 * Asks the player to make a choice a pick offered: "choose 2 skills".
 *
 * Driven entirely by an `on_pick` `choose` rule, so it knows nothing about what
 * it is choosing. An option the character already has is shown but cannot be
 * picked again, and does not count toward the total - the usual rule wherever
 * two sources would grant the same thing.
 *
 * Skipping is always allowed. The sheet stays fully editable afterwards, so a
 * choice made later, by hand, is as good as one made here.
 */
export default function ChoiceDialog({ choice, have = [], sourceLabel, onConfirm, onSkip }) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState([])
  const owned = new Set(have.map(String))
  const remaining = choice.count - picked.length

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onSkip?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const toggle = (option) =>
    setPicked((prev) =>
      prev.includes(option)
        ? prev.filter((value) => value !== option)
        : prev.length < choice.count
          ? [...prev, option]
          : prev
    )

  const title = choice.label || t('characters.chooseTitle', { count: choice.count })

  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ ...scrim, zIndex: 1200 }}>
      <div
        style={{
          ...card,
          background: 'var(--bg-panel)',
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          {sourceLabel ? (
            <p style={helpText}>{t('characters.chooseFrom', { source: sourceLabel })}</p>
          ) : null}
        </div>

        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
          {t('characters.chooseRemaining', { count: remaining })}
        </p>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: 6,
            overflowY: 'auto',
          }}
        >
          {choice.options.map((option) => {
            const already = owned.has(option)
            const selected = picked.includes(option)
            const full = !selected && remaining === 0
            return (
              <li key={option}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: already || full ? 'var(--text-muted)' : 'var(--text)',
                    cursor: already || full ? 'default' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected || already}
                    disabled={already || full}
                    onChange={() => toggle(option)}
                  />
                  {option}
                  {already ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {t('characters.alreadyHave')}
                    </span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onSkip} style={ghostBtn}>
            {t('characters.chooseLater')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.(picked)}
            disabled={!picked.length}
            style={picked.length ? goldBtn : { ...goldBtn, opacity: 0.55, cursor: 'default' }}
          >
            <LuCheck size={14} />
            {t('characters.chooseConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

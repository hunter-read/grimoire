import { useTranslation } from 'react-i18next'
import { STATE_TONE } from './shareLinkUtils'

/** A link's current state, with the reason as a tooltip when it does not work. */
export default function ShareLinkStateBadge({ state }) {
  const { t } = useTranslation()
  const tone = STATE_TONE[state] || 'var(--text-muted)'
  return (
    <span
      title={t(`share.stateHint.${state}`)}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 999,
        border: `1px solid ${tone}`,
        color: tone,
        whiteSpace: 'nowrap',
      }}
    >
      {t(`share.state.${state}`)}
    </span>
  )
}

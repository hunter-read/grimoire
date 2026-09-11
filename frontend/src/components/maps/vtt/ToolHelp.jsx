import { useTranslation } from 'react-i18next'

import { GLOBAL_HELP, TOOL_HELP } from './tools'
import { sectionTitleStyle } from './ui'

/**
 * How the active tool is driven, shown in the sidebar.
 *
 * The gestures were never discoverable. Nothing on screen said a wall ends on a
 * double-click, so a user who did not already know it was stuck mid-polyline
 * with no visible way out — unable even to tell whether the tool was working.
 *
 * It is scoped to the active tool rather than being one long list of every
 * shortcut: a reference card nobody reads is the same as no help at all, and
 * what a user needs is the two or three gestures that apply to what they are
 * doing right now. The always-true ones (pan, zoom, the snap override) follow
 * in a quieter block below.
 */
export default function ToolHelp({ tool }) {
  const { t } = useTranslation()
  const keys = TOOL_HELP[tool] || []
  // Nothing to explain for a tool with no entry: better an absent panel than a
  // heading over an empty list.
  if (keys.length === 0) return null

  const row = (text, muted) => (
    <li
      key={text}
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: muted ? 'var(--text-muted)' : 'var(--text-dim)',
        marginBottom: 4,
      }}
    >
      {text}
    </li>
  )

  return (
    <div data-testid="tool-help">
      <div style={sectionTitleStyle}>{t(`maps.vtt.tools.${tool}`)}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {keys.map((k) => row(t(`maps.vtt.help.${tool}.${k}`), false))}
      </ul>
      {GLOBAL_HELP.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: '10px 0 0',
            padding: '10px 0 0',
            borderTop: '1px dashed var(--border)',
          }}
        >
          {GLOBAL_HELP.map((k) => row(t(`maps.vtt.help.global.${k}`), true))}
        </ul>
      )}
    </div>
  )
}

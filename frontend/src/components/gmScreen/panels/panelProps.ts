import type { Panel } from '../types'

/** What every tool's body gets: its panel, and a way to save new contents. */
export interface PanelBodyProps {
  panel: Panel
  onState: (state: Record<string, unknown>) => void
}

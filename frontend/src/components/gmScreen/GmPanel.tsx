import { useTranslation } from 'react-i18next'
import type { PanelHandles } from './GmBoard'
import GmPanelFrame from './GmPanelFrame'
import { KIND_VIEWS } from './kinds'
import type { Panel, PanelKind } from './types'
import type { PanelPatch } from './useGmScreen'

interface GmPanelProps {
  panel: Panel
  handles: PanelHandles
  onSave: (patch: PanelPatch) => void
  onRemove: () => void
}

/** One panel on the board: its frame, and the tool its kind draws inside. */
export default function GmPanel({ panel, handles, onSave, onRemove }: GmPanelProps) {
  const { t } = useTranslation()
  const view = KIND_VIEWS[panel.kind as PanelKind]
  if (!view) return null
  const { Body, Settings } = view
  return (
    <GmPanelFrame
      panel={panel}
      fallbackTitle={t(`gmScreen.kinds.${panel.kind}`)}
      handles={handles}
      Settings={Settings}
      onSave={onSave}
      onRemove={onRemove}
    >
      <Body panel={panel} onState={(state) => onSave({ state })} />
    </GmPanelFrame>
  )
}

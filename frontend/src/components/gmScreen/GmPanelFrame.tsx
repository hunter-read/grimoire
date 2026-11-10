import { useState } from 'react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck, LuGripVertical, LuSettings2, LuX } from 'react-icons/lu'
import { fieldInput, fieldLabel, ghostBtn, goldBtn, iconBtn } from '../characters/characterStyles'
import type { PanelHandles } from './GmBoard'
import type { Panel } from './types'

/** What a panel's settings form edits: a draft of its config. */
export interface SettingsProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}

interface GmPanelFrameProps {
  panel: Panel
  /** The title shown when the GM has not named the panel. */
  fallbackTitle: string
  handles: PanelHandles
  /** The kind's settings form, when it has one. */
  Settings?: ComponentType<SettingsProps>
  onSave: (patch: { title: string; config: Record<string, unknown> }) => void
  onRemove: () => void
  children: ReactNode
}

const frame: CSSProperties = {
  position: 'relative',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
}

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 6px 4px 2px',
  borderBottom: '1px solid var(--border)',
  minHeight: 34,
}

/**
 * One panel's frame: a header to drag it by, its title, its settings and a way
 * to take it off the board, around whatever the tool draws. The bottom-right
 * corner resizes it.
 *
 * Settings open in place of the tool and edit a draft, so a half-made change
 * never reaches the table until the GM says it is done.
 */
export default function GmPanelFrame({
  panel,
  fallbackTitle,
  handles,
  Settings,
  onSave,
  onRemove,
  children,
}: GmPanelFrameProps) {
  const { t } = useTranslation()
  const title = panel.title || fallbackTitle
  const [draft, setDraft] = useState<{ title: string; config: Record<string, unknown> } | null>(
    null
  )
  const titleId = `gm-panel-title-${panel.id}`

  const remove = () => {
    if (window.confirm(t('gmScreen.panel.removeConfirm', { title }))) onRemove()
  }

  return (
    <section style={frame} aria-labelledby={titleId} className={`gm-panel gm-panel-${panel.kind}`}>
      <header style={header}>
        {handles.movable ? (
          <button
            type="button"
            aria-label={t('gmScreen.panel.move', { title })}
            title={t('gmScreen.panel.moveHint')}
            onPointerDown={handles.onMovePointerDown}
            onKeyDown={handles.onHandleKeyDown}
            style={{ ...iconBtn, cursor: 'grab', touchAction: 'none' }}
          >
            <LuGripVertical size={15} aria-hidden="true" />
          </button>
        ) : (
          <span style={{ width: 6 }} />
        )}
        <h2
          id={titleId}
          style={{
            flex: 1,
            minWidth: 0,
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label={t('gmScreen.panel.settings', { title })}
          aria-pressed={draft !== null}
          onClick={() =>
            setDraft(draft ? null : { title: panel.title || '', config: { ...panel.config } })
          }
          style={iconBtn}
        >
          <LuSettings2 size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('gmScreen.panel.remove', { title })}
          onClick={remove}
          style={iconBtn}
        >
          <LuX size={15} aria-hidden="true" />
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {draft ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSave(draft)
              setDraft(null)
            }}
            style={{ display: 'grid', gap: 10 }}
          >
            <label style={fieldLabel}>
              {t('gmScreen.panel.title')}
              <input
                value={draft.title}
                placeholder={fallbackTitle}
                maxLength={120}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                style={fieldInput}
              />
            </label>
            {Settings && (
              <Settings
                config={draft.config}
                onChange={(config) => setDraft({ ...draft, config })}
              />
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDraft(null)} style={ghostBtn}>
                {t('common.cancel')}
              </button>
              <button type="submit" style={goldBtn}>
                <LuCheck size={14} aria-hidden="true" /> {t('gmScreen.panel.done')}
              </button>
            </div>
          </form>
        ) : (
          children
        )}
      </div>
      {handles.movable && (
        <span
          role="presentation"
          className="gm-panel-resize"
          title={t('gmScreen.panel.resizeHint')}
          onPointerDown={handles.onResizePointerDown}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: 'nwse-resize',
            touchAction: 'none',
            background:
              'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 70%, var(--border) 70%, var(--border) 80%, transparent 80%)',
          }}
        />
      )}
    </section>
  )
}

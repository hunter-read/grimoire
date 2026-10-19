import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBold, LuItalic, LuStrikethrough, LuLink, LuList, LuListOrdered } from 'react-icons/lu'
import ToolbarButton from './ToolbarButton'
import { sanitizeLoginMessage } from '../../utils/sanitizeLoginMessage'

const editorWrapStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  overflow: 'hidden',
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 6,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel)',
}

const toolbarSepStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  margin: '0 4px',
}

const editableStyle: CSSProperties = {
  minHeight: 120,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
  lineHeight: 1.5,
}

// Rich text editor — contentEditable with execCommand for bold/italic/strike,
// link, and bulleted/numbered lists. Emits HTML via onChange.
interface RichTextEditorProps {
  value: string | null | undefined
  onChange: (html: string) => void
  ariaLabel?: string
}

export default function RichTextEditor({ value, onChange, ariaLabel }: RichTextEditorProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [, forceUpdate] = useState(0)

  // Keep DOM in sync when `value` arrives from outside (e.g. initial load).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const html = value || ''
    // While typing, the DOM already holds what onChange just reported.
    if (el.innerHTML === html) return
    // Anything else is the stored setting, which reaches innerHTML here in an
    // admin's session: sanitise it the way the login page does first. Compared
    // against the sanitised form so a value the sanitiser rewrites is applied
    // once rather than on every render.
    const safe = sanitizeLoginMessage(html)
    if (el.innerHTML !== safe) el.innerHTML = safe
  }, [value])

  const exec = useCallback(
    (command: string, arg?: string) => {
      ref.current?.focus()
      // execCommand is deprecated but still the simplest cross-browser path
      // for inline formatting in a contentEditable. Behaviour here is fine
      // for the small set of commands we support.
      document.execCommand(command, false, arg)
      if (ref.current) onChange(ref.current.innerHTML)
      forceUpdate((n) => n + 1)
    },
    [onChange]
  )

  const handleLink = useCallback(() => {
    const url = window.prompt('URL')
    if (!url) return
    // Allow http/https/mailto/relative; reject anything else (defense in depth;
    // the server also sanitizes).
    if (!/^(https?:|mailto:|\/|#)/i.test(url)) return
    exec('createLink', url)
  }, [exec])

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML)
  }

  return (
    <div style={editorWrapStyle}>
      <div style={toolbarStyle}>
        <ToolbarButton onClick={() => exec('bold')} title={t('richText.bold')}>
          <LuBold size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} title={t('richText.italic')}>
          <LuItalic size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('strikeThrough')} title={t('richText.strikethrough')}>
          <LuStrikethrough size={14} />
        </ToolbarButton>
        <span style={toolbarSepStyle} />
        <ToolbarButton onClick={handleLink} title={t('richText.link')}>
          <LuLink size={14} />
        </ToolbarButton>
        <span style={toolbarSepStyle} />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title={t('richText.bulletList')}>
          <LuList size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title={t('richText.numberedList')}>
          <LuListOrdered size={14} />
        </ToolbarButton>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        style={editableStyle}
      />
    </div>
  )
}

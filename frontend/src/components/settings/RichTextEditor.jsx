import { useState, useEffect, useRef, useCallback } from 'react'
import { LuBold, LuItalic, LuStrikethrough, LuLink, LuList, LuListOrdered } from 'react-icons/lu'
import ToolbarButton from './ToolbarButton'

const editorWrapStyle = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  overflow: 'hidden',
}

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 6,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel)',
}

const toolbarSepStyle = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  margin: '0 4px',
}

const editableStyle = {
  minHeight: 120,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
  lineHeight: 1.5,
}

// Rich text editor — contentEditable with execCommand for bold/italic/strike,
// link, and bulleted/numbered lists. Emits HTML via onChange.
export default function RichTextEditor({ value, onChange, ariaLabel }) {
  const ref = useRef(null)
  const [, forceUpdate] = useState(0)

  // Keep DOM in sync when `value` arrives from outside (e.g. initial load).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || ''
    }
  }, [value])

  const exec = useCallback(
    (command, arg) => {
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
        <ToolbarButton onClick={() => exec('bold')} title="Bold">
          <LuBold size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} title="Italic">
          <LuItalic size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('strikeThrough')} title="Strikethrough">
          <LuStrikethrough size={14} />
        </ToolbarButton>
        <span style={toolbarSepStyle} />
        <ToolbarButton onClick={handleLink} title="Link">
          <LuLink size={14} />
        </ToolbarButton>
        <span style={toolbarSepStyle} />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Bulleted list">
          <LuList size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Numbered list">
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

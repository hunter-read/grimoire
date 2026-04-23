import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'

export default function InlineTagEditor({ tags, onSave, onCancel, suggestions = [] }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState([...tags])
  const [input, setInput] = useState('')
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered =
    input.trim().length > 0
      ? suggestions.filter(
          (s) => s.toLowerCase().includes(input.trim().toLowerCase()) && !draft.includes(s)
        )
      : []

  const commit = (value) => {
    const tag = (value ?? input).trim().toLowerCase().replace(/,+$/, '')
    setInput('')
    setActiveIdx(-1)
    if (tag && !draft.includes(tag)) {
      const next = [...draft, tag]
      setDraft(next)
      onSave(next)
    }
  }

  const remove = (tag) => {
    const next = draft.filter((x) => x !== tag)
    setDraft(next)
    onSave(next)
  }

  const handleKey = (e) => {
    if (filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, -1))
        return
      }
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault()
        commit(filtered[activeIdx])
        return
      }
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      if (filtered.length > 0) {
        setInput('')
        setActiveIdx(-1)
      } else onCancel()
    } else if (e.key === 'Backspace' && !input && draft.length > 0) {
      const next = draft.slice(0, -1)
      setDraft(next)
      onSave(next)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 5,
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {draft.map((tag) => (
        <span key={tag} style={editTagStyle}>
          {tag}
          <button
            onClick={() => remove(tag)}
            aria-label={t('inlineTagEditor.removeTag', { tag })}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              padding: '0 0 0 4px',
              lineHeight: 1,
            }}
          >
            <LuX size={10} />
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setActiveIdx(-1)
          }}
          onKeyDown={handleKey}
          placeholder={t('inlineTagEditor.placeholder')}
          style={{
            fontSize: 13,
            padding: '2px 8px',
            borderRadius: 10,
            width: 120,
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        />
        {filtered.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 2,
              zIndex: 100,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              minWidth: 140,
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            {filtered.map((s, i) => (
              <div
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(s)
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: i === activeIdx ? 'var(--bg-card-hover)' : 'transparent',
                  color: 'var(--text)',
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => {
          commit()
          onCancel()
        }}
        style={cancelBtnStyle}
      >
        {t('common.done')}
      </button>
    </div>
  )
}

const editTagStyle = {
  fontSize: 12,
  padding: '2px 6px 2px 8px',
  borderRadius: 10,
  background: 'rgba(201, 168, 76, 0.15)',
  border: '1px solid var(--gold-dim)',
  color: 'var(--gold)',
  display: 'inline-flex',
  alignItems: 'center',
}

const cancelBtnStyle = {
  padding: '3px 10px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}

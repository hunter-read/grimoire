import { useState, useRef, useEffect } from 'react'
import { LuX } from 'react-icons/lu'

export default function InlineTagEditor({ tags, onSave, onCancel }) {
  const [draft, setDraft] = useState([...tags])
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const commit = () => {
    const t = input.trim().toLowerCase().replace(/,+$/, '')
    setInput('')
    if (t && !draft.includes(t)) {
      const next = [...draft, t]
      setDraft(next)
      onSave(next)
    }
  }

  const remove = (tag) => {
    const next = draft.filter(x => x !== tag)
    setDraft(next)
    onSave(next)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') onCancel()
    else if (e.key === 'Backspace' && !input && draft.length > 0) {
      const next = draft.slice(0, -1)
      setDraft(next)
      onSave(next)
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
      {draft.map(t => (
        <span key={t} style={editTagStyle}>
          {t}
          <button
            onClick={() => remove(t)}
            aria-label={`Remove tag ${t}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 0 0 4px', lineHeight: 1 }}
          >
            <LuX size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Add tag…"
        style={{ fontSize: 13, padding: '2px 8px', borderRadius: 10, width: 100, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
      />
      <button onClick={() => { commit(); onCancel() }} style={cancelBtnStyle}>Done</button>
    </div>
  )
}

const editTagStyle = {
  fontSize: 12, padding: '2px 6px 2px 8px', borderRadius: 10,
  background: 'rgba(201, 168, 76, 0.15)', border: '1px solid var(--gold-dim)', color: 'var(--gold)',
  display: 'inline-flex', alignItems: 'center',
}

const cancelBtnStyle = {
  padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  background: 'var(--bg-card)', color: 'var(--text-dim)', border: '1px solid var(--border)',
}

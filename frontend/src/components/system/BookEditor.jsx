import { useState } from 'react'
import { LuX } from 'react-icons/lu'
import api from '../../api'
import InlineTagEditor from '../maps/InlineTagEditor'

export default function BookEditor({ book, onSave, onClose }) {
  const [form, setForm] = useState({
    title:       book.title       || '',
    description: book.description || '',
    authors:     (book.authors    || []).join(', '),
    publisher:   book.publisher   || '',
    year:        book.year        ? String(book.year) : '',
    category:    book.category    || 'core',
    is_explicit: book.is_explicit || false,
  })
  const [tags, setTags] = useState(book.tags || [])
  const [editingTags, setEditingTags] = useState(false)
  const [saving, setSaving] = useState(false)

  const field = (label, key, opts = {}) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {opts.textarea
        ? <textarea value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} rows={3} style={{ width: '100%', resize: 'vertical', fontSize: 13 }} />
        : <input type="text" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ width: '100%', fontSize: 13 }} />
      }
    </div>
  )

  const handleSave = () => {
    setSaving(true)
    const payload = {
      ...form,
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
      year: form.year ? parseInt(form.year) : null,
      tags,
    }
    api.patch(`/books/${book.id}`, payload)
      .then(() => { onSave({ ...book, ...payload }); setSaving(false) })
      .catch(() => setSaving(false))
  }


  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-dim)' }}>Edit Metadata</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><LuX size={14} /></button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 'fit-content' }}>
          <input
            type="checkbox"
            checked={form.is_explicit}
            onChange={e => setForm(f => ({ ...f, is_explicit: e.target.checked }))}
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#e07070' }}
          />
          <span style={{ fontSize: 13, color: '#e07070' }}>Mark as explicit content</span>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 16px' }}>
        <div>
          {field('Title', 'title')}
          {field('Description', 'description', { textarea: true })}
        </div>
        <div>
          {field('Category', 'category')}
          {field('Authors (comma-separated)', 'authors')}
          {field('Publisher', 'publisher')}
          {field('Year', 'year')}
        </div>
      </div>


      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Tags</label>
        {editingTags ? (
          <InlineTagEditor
            tags={tags}
            onSave={setTags}
            onCancel={() => setEditingTags(false)}
          />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            {tags.map(t => (
              <span key={t} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'rgba(201,168,76,0.15)', border: '1px solid var(--gold-dim)', color: 'var(--gold)' }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </span>
            ))}
            <button onClick={() => setEditingTags(true)} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              {tags.length > 0 ? 'Edit tags' : '+ Add tags'}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} style={{ padding: '6px 14px', borderRadius: 5, background: 'var(--gold-dim)', border: 'none', color: 'var(--bg-deep)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImage, LuX, LuPlus } from 'react-icons/lu'
import api, { mediaUrl } from '../../api'

export default function SystemEditor({ system, onSave }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    description: system.description || '',
    publishers: system.publishers?.length ? system.publishers : [{ name: '', url: '' }],
    character_builder_url: system.character_builder_url || '',
    tags: system.tags || [],
    genre: system.genre || '',
    cover_book_id: system.cover_book_id || null,
    is_explicit: system.is_explicit || false,
  })
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef(null)

  const commitTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/,+$/, '')
    if (tag && !form.tags.includes(tag)) setForm((f) => ({ ...f, tags: [...f.tags, tag] }))
    setTagInput('')
  }

  const handleTagKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag()
    } else if (e.key === 'Backspace' && !tagInput && form.tags.length > 0)
      setForm((f) => ({ ...f, tags: f.tags.slice(0, -1) }))
  }

  const handleSave = () => {
    const pending = tagInput.trim().toLowerCase().replace(/,+$/, '')
    const tags = pending && !form.tags.includes(pending) ? [...form.tags, pending] : form.tags
    const publishers = form.publishers.filter((p) => p.name.trim())
    const data = { ...form, tags, publishers }
    api.patch(`/systems/${system.id}`, data).then(() => onSave(data))
  }

  const setPublisher = (idx, key, value) =>
    setForm((f) => ({
      ...f,
      publishers: f.publishers.map((p, i) => (i === idx ? { ...p, [key]: value } : p)),
    }))

  const addPublisher = () =>
    setForm((f) => ({ ...f, publishers: [...f.publishers, { name: '', url: '' }] }))

  const removePublisher = (idx) =>
    setForm((f) => ({ ...f, publishers: f.publishers.filter((_, i) => i !== idx) }))

  const booksWithThumbnails = (system.books || []).filter((b) => b.has_thumbnail)

  const field = (label, key, type = 'text') => (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{ fontSize: 14, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
      >
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          style={{ width: '100%' }}
        />
      )}
    </div>
  )

  return (
    <div
      className="fade-in"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 24,
        marginBottom: 32,
      }}
    >
      <h4 style={{ fontSize: 16, marginBottom: 16 }}>{t('systemEditor.title')}</h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0 20px',
        }}
      >
        <div>
          {field(t('systemEditor.description'), 'description', 'textarea')}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                fontSize: 14,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('systemEditor.tags')}
            </label>
            <div
              onClick={() => tagInputRef.current?.focus()}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 5,
                alignItems: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'text',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                minHeight: 36,
              }}
            >
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 12,
                    padding: '2px 6px 2px 8px',
                    borderRadius: 10,
                    background: 'rgba(201,168,76,0.15)',
                    border: '1px solid var(--gold-dim)',
                    color: 'var(--gold)',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {tag}
                  <button
                    onClick={() =>
                      setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }))
                    }
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
              <input
                ref={tagInputRef}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKey}
                onBlur={commitTag}
                placeholder={form.tags.length === 0 ? t('systemEditor.tagPlaceholder') : ''}
                style={{
                  fontSize: 13,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  minWidth: 80,
                  flex: 1,
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {t('systemEditor.tagHint')}
            </div>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                fontSize: 14,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('systemEditor.publishers')}
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.publishers.map((p, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => setPublisher(idx, 'name', e.target.value)}
                    placeholder={t('systemEditor.publisherNamePlaceholder')}
                    style={{ flex: '1 1 140px', minWidth: 0 }}
                  />
                  <input
                    type="text"
                    value={p.url}
                    onChange={(e) => setPublisher(idx, 'url', e.target.value)}
                    placeholder={t('systemEditor.publisherUrlPlaceholder')}
                    style={{ flex: '1 1 180px', minWidth: 0 }}
                  />
                  <button
                    onClick={() => removePublisher(idx)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      padding: 4,
                    }}
                  >
                    <LuX size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={addPublisher}
                style={{
                  alignSelf: 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  padding: '2px 0',
                }}
              >
                <LuPlus size={13} /> {t('systemEditor.addPublisher')}
              </button>
            </div>
          </div>
          {field(t('systemEditor.characterBuilderUrl'), 'character_builder_url')}
          {field(t('systemEditor.genre'), 'genre')}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                width: 'fit-content',
              }}
            >
              <input
                type="checkbox"
                checked={form.is_explicit}
                onChange={(e) => setForm((f) => ({ ...f, is_explicit: e.target.checked }))}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                {t('systemEditor.markExplicit')}
              </span>
            </label>
          </div>
        </div>
      </div>
      {booksWithThumbnails.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <label
            style={{
              fontSize: 14,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 10,
            }}
          >
            <LuImage size={14} /> {t('systemEditor.coverImage')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {booksWithThumbnails.map((b) => (
              <button
                key={b.id}
                onClick={() =>
                  setForm((f) => ({ ...f, cover_book_id: f.cover_book_id === b.id ? null : b.id }))
                }
                title={b.title}
                style={{
                  padding: 0,
                  border: `2px solid ${form.cover_book_id === b.id ? 'var(--gold)' : 'var(--border)'}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'none',
                  width: 60,
                  height: 80,
                  flexShrink: 0,
                  boxShadow: form.cover_book_id === b.id ? '0 0 0 2px var(--gold-dim)' : 'none',
                }}
              >
                <img
                  src={mediaUrl(`/books/${b.id}/thumbnail`)}
                  alt={b.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
          {form.cover_book_id && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
              {t('systemEditor.selected', {
                title: booksWithThumbnails.find((b) => b.id === form.cover_book_id)?.title,
              })}
              <button
                onClick={() => setForm((f) => ({ ...f, cover_book_id: null }))}
                style={{
                  background: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  marginLeft: 8,
                  textDecoration: 'underline',
                }}
              >
                {t('systemEditor.clearCover')}
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSave}
        style={{
          padding: '10px 24px',
          borderRadius: 6,
          background: 'var(--gold-dim)',
          color: 'var(--bg-deep)',
          fontSize: 16,
          fontWeight: 600,
          marginTop: 8,
        }}
      >
        {t('systemEditor.saveChanges')}
      </button>
    </div>
  )
}

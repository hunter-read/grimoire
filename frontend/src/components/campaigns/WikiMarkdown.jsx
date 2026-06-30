import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LuFileQuestion } from 'react-icons/lu'
import EmbedCard from './EmbedCard'

// We avoid a custom remark tokenizer by rewriting [[...]] tokens into ordinary
// markdown links with a private href scheme, then interpreting that scheme in a
// custom `a` renderer below.
//   [[Page Title]]            -> [Page Title](grimoire-wiki:slug-of-title)
//   [[Page Title|label]]      -> [label](grimoire-wiki:slug-of-title)
//   [[book:ID]] / [[book:ID:PAGE]] / [[map:ID]] / [[token:ID]] / [[audio:ID]] / [[file:ID]] / [[image:ID]]
//                             -> [embed](grimoire-embed:book:ID:PAGE)
const LINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g
const EMBED_PREFIXES = ['book:', 'map:', 'token:', 'audio:', 'file:', 'image:']

// ||GM-only text||. Only the owner ever receives a body still containing these
// (the backend strips them for everyone else), so rendering them as a tinted
// "GM only" span just helps the owner see what players won't. The match spans
// newlines so a secret can wrap several lines/paragraphs.
const SECRET_RE = /\|\|([\s\S]*?)\|\|/g

function slugify(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-') || 'untitled'
  )
}

function escapeLinkText(text) {
  // Keep link text from breaking the markdown link syntax. Escape backslashes
  // first so a user-supplied trailing "\" can't combine with the "]" we add and
  // escape our own closing bracket.
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

// Rewrite [[...]] page links and Grimoire embeds into our private link schemes.
function rewriteLinks(text) {
  return text.replace(LINK_RE, (_match, target, label) => {
    const t = target.trim()
    const lower = t.toLowerCase()
    if (EMBED_PREFIXES.some((p) => lower.startsWith(p))) {
      return `[embed](grimoire-embed:${t})`
    }
    const linkText = escapeLinkText((label || t).trim())
    return `[${linkText}](grimoire-wiki:${slugify(t)})`
  })
}

// Split a body into ordered segments, isolating multiline ||GM secrets|| so they
// can be wrapped in a tinted block. A single-line secret can't be split out —
// doing so would break its paragraph in two — so it's left in the surrounding
// text segment as a private grimoire-secret: link (rendered as an inline tinted
// span). Only a secret that spans newlines (which has no inline markdown form)
// becomes its own block segment. Each segment's markdown is otherwise unchanged.
function splitSecrets(body) {
  const src = body || ''
  const segments = []
  let buf = '' // accumulates ordinary text + inline secrets up to the next block
  const flush = () => {
    if (buf) {
      segments.push({ block: false, text: rewriteLinks(buf) })
      buf = ''
    }
  }
  let last = 0
  SECRET_RE.lastIndex = 0
  let m
  while ((m = SECRET_RE.exec(src)) !== null) {
    buf += src.slice(last, m.index)
    const inner = m[1]
    if (/[\r\n]/.test(inner)) {
      // Block secret: flush the inline run, then emit the secret on its own with
      // its inner markdown intact for a separate render pass.
      flush()
      segments.push({ block: true, text: rewriteLinks(inner) })
    } else {
      // Inline secret: fold into the running text as a tinted link so it stays in
      // the flow of the paragraph it lives in.
      buf += `[${escapeLinkText(inner)}](grimoire-secret:)`
    }
    last = m.index + m[0].length
  }
  buf += src.slice(last)
  flush()
  return segments
}

export default function WikiMarkdown({ body, campaignId, pageSlugs = [], onOpenSlug }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const slugSet = useMemo(() => new Set(pageSlugs), [pageSlugs])
  const segments = useMemo(() => splitSecrets(body), [body])

  const components = useMemo(
    () => ({
      a({ href, children, ...props }) {
        if (href?.startsWith('grimoire-secret:')) {
          return (
            <span
              title={t('wiki.secretHint')}
              style={{
                // A low-alpha gold tint (not the solid --gold-dim) so it reads as
                // a highlight without washing out gold headings or white body text.
                background: 'rgba(201, 168, 76, 0.16)',
                boxShadow: 'inset 2px 0 0 var(--gold)',
                color: 'inherit',
                borderRadius: 3,
                padding: '0 4px',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
              }}
            >
              {children}
            </span>
          )
        }
        if (href?.startsWith('grimoire-wiki:')) {
          const slug = href.slice('grimoire-wiki:'.length)
          const exists = slugSet.has(slug)
          return (
            <button
              type="button"
              onClick={() => onOpenSlug?.(slug)}
              title={exists ? undefined : t('wiki.missingPageHint')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
                color: exists ? 'var(--gold)' : 'var(--danger)',
                borderBottom: exists
                  ? '1px solid var(--gold-dim, var(--gold))'
                  : '1px dashed var(--danger)',
              }}
            >
              {children}
            </button>
          )
        }
        if (href?.startsWith('grimoire-embed:')) {
          return (
            <EmbedCard
              spec={href.slice('grimoire-embed:'.length)}
              campaignId={campaignId}
              onNavigate={navigate}
            />
          )
        }
        // Ordinary external/internal links.
        const external = href && /^https?:\/\//.test(href)
        return (
          <a
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            style={{ color: 'var(--gold)' }}
            {...props}
          >
            {children}
          </a>
        )
      },
      img({ src, alt }) {
        return (
          <img
            src={src}
            alt={alt || ''}
            style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '8px 0' }}
          />
        )
      },
      table({ children }) {
        return (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0' }}>
              {children}
            </table>
          </div>
        )
      },
      th({ children }) {
        return <th style={cellStyle(true)}>{children}</th>
      },
      td({ children }) {
        return <td style={cellStyle(false)}>{children}</td>
      },
      blockquote({ children }) {
        return (
          <blockquote
            style={{
              borderLeft: '3px solid var(--border-light, var(--border))',
              margin: '8px 0',
              padding: '2px 14px',
              color: 'var(--text-dim)',
            }}
          >
            {children}
          </blockquote>
        )
      },
      code({ inline, children }) {
        if (inline) {
          return (
            <code
              style={{
                background: 'var(--bg-deep)',
                borderRadius: 4,
                padding: '1px 5px',
                fontSize: '0.9em',
              }}
            >
              {children}
            </code>
          )
        }
        return (
          <pre
            style={{
              background: 'var(--bg-deep)',
              borderRadius: 8,
              padding: 12,
              overflowX: 'auto',
            }}
          >
            <code>{children}</code>
          </pre>
        )
      },
    }),
    [slugSet, onOpenSlug, navigate, t, campaignId]
  )

  if (!body?.trim()) {
    return (
      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 14 }}>
        <LuFileQuestion
          size={14}
          aria-hidden="true"
          style={{ verticalAlign: 'middle', marginRight: 6 }}
        />
        {t('wiki.emptyPage')}
      </div>
    )
  }

  const renderMarkdown = (text) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      // Preserve our private grimoire-wiki:/grimoire-embed: schemes, which
      // react-markdown's default urlTransform would otherwise strip.
      urlTransform={(url) => url}
    >
      {text}
    </ReactMarkdown>
  )

  return (
    <div className="wiki-markdown" style={{ fontSize: 15, lineHeight: 1.7 }}>
      {segments.map((seg, i) =>
        seg.block ? (
          <div key={i} title={t('wiki.secretHint')} style={secretBlockStyle}>
            {renderMarkdown(seg.text)}
          </div>
        ) : (
          <Fragment key={i}>{renderMarkdown(seg.text)}</Fragment>
        )
      )}
    </div>
  )
}

const secretBlockStyle = {
  // Low-alpha gold tint + gold rule, so headings and body text inside stay legible.
  background: 'rgba(201, 168, 76, 0.1)',
  borderLeft: '3px solid var(--gold)',
  borderRadius: 4,
  padding: '4px 12px',
  margin: '8px 0',
}

function cellStyle(header) {
  return {
    border: '1px solid var(--border)',
    padding: '6px 10px',
    textAlign: 'left',
    background: header ? 'var(--bg-deep)' : 'transparent',
    fontWeight: header ? 600 : 400,
  }
}

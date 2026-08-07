import { Fragment, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LuFileQuestion } from 'react-icons/lu'
import EmbedCard from './EmbedCard'
import LazyImg from '../LazyImg'
import { isEmbed, parseTarget, resolvePage } from './wikiLinkTarget'
import { buildHeadingComponents, headingDomId } from './wikiHeadings'

// We avoid a custom remark tokenizer by rewriting [[...]] tokens into ordinary
// markdown links with a private href scheme, then interpreting that scheme in a
// custom `a` renderer below.
//   [[Page Title]]                    -> [Page Title](grimoire-wiki:<encoded target>)
//   [[Page Title|label]]              -> [label](grimoire-wiki:<encoded target>)
//   [[Page Title:id-ID:#Heading]]     -> [Page Title](grimoire-wiki:<encoded target>)
//   [[book:ID]] / [[book:ID:PAGE]] / [[map:ID]] / [[token:ID]] / [[audio:ID]] / [[file:ID]] / [[image:ID]]
//                                     -> [embed](grimoire-embed:book:ID:PAGE)
//
// The href carries the *whole* raw target (URI-encoded) rather than a slug, so
// the renderer can resolve by page id and honour a :#Heading suffix. Encoding
// keeps ":" and spaces from being reinterpreted as part of the scheme.
const LINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g

// ||GM-only text||. Only the owner ever receives a body still containing these
// (the backend strips them entirely for everyone else — no text, no marker), so
// rendering them as a tinted "GM only" span just helps the owner see what players
// won't. The match spans newlines so a secret can wrap several lines/paragraphs.
const SECRET_RE = /\|\|([\s\S]*?)\|\|/g

// Decode a percent-encoded target, tolerating malformed input (a stray "%" would
// otherwise throw). Returns the original string if it can't be decoded.
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
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
    if (isEmbed(t)) {
      return `[embed](grimoire-embed:${t})`
    }
    // The visible text is the label if given, else the title alone — the :id- and
    // :#Heading suffixes are addressing, not something the reader should see.
    const { title } = parseTarget(t)
    const linkText = escapeLinkText((label || title || t).trim())
    return `[${linkText}](grimoire-wiki:${encodeURIComponent(t)})`
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

/**
 * Render a wiki page body.
 *
 * `pages` is the campaign's visible page list ({ id, title, slug }), used to
 * resolve [[links]] by id or title and to grey out ones that point nowhere.
 * `onOpenPage(page, heading)` navigates to a link's target; `heading` is the
 * `:#Heading` suffix when present, so the caller can scroll to it after the page
 * loads. A link to the *current* page's heading scrolls in place instead.
 */
export default function WikiMarkdown({
  body,
  campaignId,
  pages = [],
  currentPageId = null,
  onOpenPage,
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const segments = useMemo(() => splitSecrets(body), [body])

  // Scroll to a heading inside the body currently on screen. Headings are given
  // ids by the `h1..h6` renderers below, keyed on the normalized heading text.
  const scrollToHeading = useCallback((heading) => {
    if (typeof document === 'undefined') return
    const id = headingDomId(heading)
    // Guarded: scrollIntoView is absent in jsdom and older embedded views.
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

  const openLink = useCallback(
    (rawTarget) => {
      const link = parseTarget(rawTarget)
      const target = resolvePage(link, pages)
      if (target && target.id === currentPageId && link.heading) {
        scrollToHeading(link.heading)
        return
      }
      onOpenPage?.(target, link.heading, link)
    },
    [pages, currentPageId, onOpenPage, scrollToHeading]
  )

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
          // We percent-encode the target when rewriting, and react-markdown
          // additionally encodes non-ASCII (e.g. "breitfuß" -> "breitfu%C3%9F"),
          // so decode before parsing or the suffixes won't match (issue #252).
          const rawTarget = safeDecode(href.slice('grimoire-wiki:'.length))
          const link = parseTarget(rawTarget)
          const target = resolvePage(link, pages)
          // A pinned link whose page is gone is broken; so is an unknown title.
          const exists = !!target
          return (
            <button
              type="button"
              onClick={() => openLink(rawTarget)}
              title={
                exists
                  ? link.heading
                    ? t('wiki.headingLinkHint', { heading: link.heading })
                    : undefined
                  : // A pinned link names a page that once existed, so a failure
                    // to resolve means it was deleted — it won't be re-created.
                    // An unpinned one still auto-creates its target on save.
                    t(link.pageId ? 'wiki.brokenLinkHint' : 'wiki.missingPageHint')
              }
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
          <LazyImg
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
      // Headings get a deterministic id derived from their text, which is what
      // a [[Page:#Heading]] link scrolls to. Keyed on normalized text (not
      // document order) so the anchor survives edits elsewhere in the page.
      ...buildHeadingComponents(),
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
    [pages, openLink, navigate, t, campaignId]
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
    <div
      className="wiki-markdown"
      style={{ fontSize: 15, lineHeight: 1.7, overflowWrap: 'anywhere' }}
    >
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

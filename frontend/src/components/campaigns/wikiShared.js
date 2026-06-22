import { LuShield, LuUsers, LuLock } from 'react-icons/lu'

// Return the ids of `pageId` and all its descendants, so a parent picker can
// exclude them (a page may not nest under itself or its own subtree).
export function descendantIds(pageId, pages) {
  const childrenOf = {}
  for (const p of pages) (childrenOf[p.parent_id] ||= []).push(p)
  const out = new Set([pageId])
  const stack = [pageId]
  while (stack.length) {
    for (const child of childrenOf[stack.pop()] || []) {
      if (!out.has(child.id)) {
        out.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return out
}

// Visibility colour coding: GM-only is the app's red, Private uses the same gold
// as default icons, and Public is plain white/foreground.
export const VIS_META = {
  gm: { Icon: LuShield, color: 'var(--red)', key: 'gm' },
  group: { Icon: LuUsers, color: 'var(--text)', key: 'group' },
  members: { Icon: LuLock, color: 'var(--gold)', key: 'members' },
}

export function badgeStyle(meta, interactive) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: meta.color,
    background: 'transparent',
    border: `1px solid var(--border)`,
    borderRadius: 12,
    padding: '1px 8px',
    cursor: interactive ? 'pointer' : 'default',
    font: 'inherit',
    lineHeight: 1.6,
  }
}

export const POPOVER_WIDTH = 220

// ----- Wiki editor / toolbar styles (shared by WikiView and PageEditor) -----

export const toolbarBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 12,
}
export const toolbarBtnActive = {
  background: 'var(--bg-card)',
  borderColor: 'var(--gold)',
  color: 'var(--gold)',
}
export const toolbarGroup = {
  display: 'inline-flex',
  gap: 2,
  padding: 2,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}
export const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 26,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
export const toolbarControl = {
  appearance: 'auto',
  fontSize: 12,
  padding: '5px 8px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
}
export const paneLabel = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  marginBottom: 6,
}
export const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '7px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
}
export const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: '#1a1209',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

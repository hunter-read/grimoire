"""Import / export handlers for the campaign wiki.

Export produces one of three shapes: a `.zip` of one markdown file per page
(Obsidian-style, with light YAML frontmatter), a single `.md` file with every
page concatenated under nesting-aware headings (for reading or printing outside
Grimoire), or a single Grimoire JSON bundle. Import is the inverse of the zip and
JSON forms, and additionally understands several foreign shapes:

  * A single markdown file (or a `.zip` of markdown files / Obsidian vault).
  * A legacy LegendKeeper per-page JSON export — either a single page JSON or a
    `.zip` of the per-page JSON files. Those store page bodies as HTML, which we
    convert to markdown on the way in.
  * A current LegendKeeper bundle export — `{"version", "resources": [...]}`,
    where each resource is a page whose body is ProseMirror document JSON and
    whose `parentId` links it to its container. We convert the ProseMirror body to
    markdown and preserve the parent/child hierarchy as nested wiki pages.

The conversion is lossy for LegendKeeper-only block types (secrets, embeds),
matching LegendKeeper's own export caveats.

Page nesting is preserved on import: a record may name a `parent_key`, and we
reparent the created page under whichever record produced that key.

Import is always non-destructive: every record becomes a new page with a unique
slug; existing pages are never overwritten. Internal links are remapped to the
slugs we actually assign so cross-references survive the round trip.
"""

import io
import json
import re
import zipfile

from fastapi import Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from fastapi.responses import Response

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import WikiPage
from ._helpers import (
    assert_can_manage,
    can_view,
    get_campaign_or_404,
    strip_gm_secrets,
)
from ._schemas import clean_icon_color
from .wiki import (
    _ensure_unique_slug,
    _page_summary,
    can_view_page,
    rebuild_links,
    slugify,
)
from .wikilinks import build_target, parse_target

BUNDLE_VERSION = 1
_MAX_IMPORT_BYTES = 25 * 1024 * 1024  # 25 MB — bounds a single in-memory read.

# LegendKeeper wraps page bodies in <div class='lk-tab' id='...'>...</div> and
# emits secret/special blocks as <div data-node-type=...>...</div>. Internal page
# links are <a href="<id>.html">Label</a>. (Mirrors curiousCephalopod/lk-import.)
_LK_WRAP_RE = re.compile(r"<div class=['\"]lk-tab['\"][^>]*>(.*)</div>\s*$", re.DOTALL)
_LK_SPECIAL_RE = re.compile(r"<div data-node-type[^>]*>.*?</div>", re.DOTALL)
# A markdown link to a LegendKeeper page, as markdownify renders the original
# <a href="<id>.html">: [label](<id>.html). The id may be percent/relative-pathed.
_MD_LK_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]*?)\.html\)")

# Frontmatter keys we read/write. Anything else in a foreign file is ignored.
_FM_KEYS = (
    "title", "visibility", "parent", "icon", "icon_color", "page_type", "session_date",
)
_VALID_VIS = ("gm", "group", "members")


def _safe_icon_color(value) -> str | None:
    """An imported icon tint, or None when absent/not an accepted value."""
    if not isinstance(value, str):
        return None
    try:
        return clean_icon_color(value) or None
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #


def _frontmatter(page: WikiPage, parent_slug) -> str:
    """A minimal YAML frontmatter block for a markdown export of a page."""
    lines = ["---", f"title: {_yaml_scalar(page.title)}", f"visibility: {page.visibility}"]
    if parent_slug:
        lines.append(f"parent: {_yaml_scalar(parent_slug)}")
    if page.icon:
        lines.append(f"icon: {_yaml_scalar(page.icon)}")
    if page.icon_color:
        lines.append(f"icon_color: {page.icon_color}")
    if page.page_type and page.page_type != "note":
        lines.append(f"page_type: {page.page_type}")
    if page.session_date:
        lines.append(f"session_date: {page.session_date}")
    lines.append("---")
    return "\n".join(lines)


def _yaml_scalar(value: str) -> str:
    """Quote a scalar if it could be misread by a YAML parser."""
    s = value or ""
    if s == "" or re.search(r"[:#\[\]{}&*!|>'\"%@`]", s) or s.strip() != s:
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def _tree_order(pages: list) -> list:
    """Return (page, depth) pairs in sidebar order: depth-first, children after
    their parent, siblings by sort_order then title.

    `pages` is already sorted that way among siblings, so a single pass per
    parent preserves it. A page whose parent isn't in the list (filtered out by
    visibility, for a non-owner export) is treated as a root so it can't be lost.
    """
    ids = {p.id for p in pages}
    children: dict = {}
    for p in pages:
        parent = p.parent_id if p.parent_id in ids else None
        children.setdefault(parent, []).append(p)
    out: list = []
    # Iterative walk, so a pathologically deep tree can't blow the stack.
    stack = [(p, 0) for p in reversed(children.get(None, []))]
    seen = set()
    while stack:
        page, depth = stack.pop()
        if page.id in seen:
            continue
        seen.add(page.id)
        out.append((page, depth))
        stack.extend((c, depth + 1) for c in reversed(children.get(page.id, [])))
    return out


def _shift_headings(body: str, by: int) -> str:
    """Push every ATX heading in `body` down `by` levels, capped at 6.

    Keeps a combined export's outline coherent: each page's own `#` headings sit
    below the heading we give the page itself. Fenced code blocks are skipped so
    a `# comment` inside one isn't mistaken for a heading.
    """
    if by <= 0:
        return body
    out = []
    fence = None
    for line in (body or "").splitlines():
        stripped = line.lstrip()
        marker = stripped[:3]
        if marker in ("```", "~~~"):
            if fence is None:
                fence = marker
            elif stripped.startswith(fence):
                fence = None
            out.append(line)
            continue
        m = re.match(r"^(#{1,6})(\s+.*)$", line) if fence is None else None
        out.append(f"{'#' * min(6, len(m.group(1)) + by)}{m.group(2)}" if m else line)
    return "\n".join(out)


def _combined_markdown(campaign_name: str, ordered: list, body_of) -> str:
    """One markdown document holding every page, nested by heading level."""
    parts = [f"# {campaign_name}\n"]
    for page, depth in ordered:
        # Page titles start at H2 (H1 is the campaign) and follow the tree down
        # to the H6 floor, where deeper pages simply share a level.
        level = min(6, depth + 2)
        parts.append(f"{'#' * level} {page.title}\n")
        body = (body_of(page) or "").strip()
        if body:
            parts.append(_shift_headings(body, level) + "\n")
    return "\n".join(parts)


def export_wiki(
    campaign_id: str,
    format: str = Query("md", pattern="^(md|mdfile|json)$"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export a campaign's wiki as a markdown zip, a single markdown file, or a
    JSON bundle.

    Available to any campaign viewer, not just the owner: a player who is leaving
    (or moving to another platform) can take their copy of the campaign with them.
    Deliberately still works on an archived campaign — archiving is exactly when
    someone wants their notes out — since exporting reads rather than writes.

    Everyone receives only what they can already see in the app: pages that fail
    ``can_view_page`` are omitted entirely, and ``||GM secrets||`` are stripped
    from a player's bodies. The page filter now applies to the campaign owner
    too — since ``gm`` visibility means "author only", a GM is no more entitled
    to export a player's self-only note than to read it (issue #232). Secrets
    remain GM-only regardless of who authored the page holding them.
    """
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    is_gm = c.owner_id == current_user.id

    pages = db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
    pages = [p for p in pages if can_view_page(p, c, current_user, db)]
    pages.sort(key=lambda p: (p.sort_order or 0, (p.title or "").lower()))
    by_id = {p.id: p for p in pages}
    # A page's parent slug, used to round-trip nesting through the export.
    parent_slug = {
        p.id: (by_id[p.parent_id].slug if p.parent_id in by_id else None)
        for p in pages
    }
    base = slugify(c.name) or "campaign"

    # The GM's export is verbatim; a player's has GM secrets removed, the same
    # body they'd see in the reader.
    def body_of(p) -> str:
        return (p.body or "") if is_gm else strip_gm_secrets(p.body or "")

    if format == "json":
        bundle = {
            "grimoire_wiki_version": BUNDLE_VERSION,
            "campaign": c.name,
            "pages": [
                {
                    "title": p.title,
                    "slug": p.slug,
                    "body": body_of(p),
                    "visibility": p.visibility,
                    "page_type": p.page_type,
                    "session_date": p.session_date,
                    "icon": p.icon,
                    "icon_color": p.icon_color,
                    "parent": parent_slug[p.id],
                }
                for p in pages
            ],
        }
        data = json.dumps(bundle, indent=2, ensure_ascii=False).encode("utf-8")
        return Response(
            content=data,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{base}-wiki.json"'},
        )

    if format == "mdfile":
        # One document, pages in sidebar order and nested by heading level. Not
        # a round-trip format (no frontmatter, so nothing to re-import from) —
        # it's for reading, printing, or pasting the whole wiki elsewhere.
        text = _combined_markdown(c.name, _tree_order(pages), body_of)
        return Response(
            content=text.encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{base}-wiki.md"'},
        )

    # format == "md": a zip of one markdown file per page.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        used = set()
        for p in pages:
            name = p.slug or slugify(p.title)
            fname = f"{name}.md"
            n = 2
            while fname in used:
                fname = f"{name}-{n}.md"
                n += 1
            used.add(fname)
            fm = _frontmatter(p, parent_slug[p.id])
            zf.writestr(fname, f"{fm}\n\n{body_of(p)}\n")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{base}-wiki.zip"'},
    )


# --------------------------------------------------------------------------- #
# Format parsers — each returns a list of records:
#   {title, body, visibility, icon, icon_color, page_type, session_date,
#    source_key, parent_key}
# `source_key` is whatever foreign id/title other records link to, used to remap
# internal links to the slugs we assign on import.
# --------------------------------------------------------------------------- #


def _record(title, body, *, visibility="gm", icon=None, icon_color=None, page_type="note",
            session_date=None, source_key=None, parent_key=None):
    if visibility not in _VALID_VIS:
        visibility = "gm"
    if page_type not in ("note", "session"):
        page_type = "note"
    title = (title or "").strip() or "Untitled"
    return {
        "title": title,
        "body": body or "",
        "visibility": visibility,
        "icon": (icon or None),
        # Imported files are untrusted: drop a tint we wouldn't accept over the
        # API rather than letting it reach the DB (and then a style attribute).
        "icon_color": _safe_icon_color(icon_color),
        "page_type": page_type,
        "session_date": session_date or None,
        "source_key": source_key if source_key is not None else title,
        # The source_key of the record this one nests under (None = top level).
        "parent_key": parent_key or None,
    }


def _split_frontmatter(text: str) -> tuple:
    """Return (frontmatter_dict, body). Frontmatter is the simple `key: value`
    subset we emit; we don't pull a full YAML parser in for this."""
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    fm = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        if key not in _FM_KEYS:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        fm[key] = val
    return fm, m.group(2)


def parse_markdown_file(name: str, text: str) -> dict:
    """A single markdown file → one record. Title: frontmatter → first `#` → filename."""
    fm, body = _split_frontmatter(text)
    title = fm.get("title")
    if not title:
        heading = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        if heading:
            title = heading.group(1).strip()
    if not title:
        title = re.sub(r"\.(md|markdown|txt)$", "", name, flags=re.IGNORECASE)
        title = title.rsplit("/", 1)[-1]
    return _record(
        title,
        body,
        visibility=fm.get("visibility", "gm"),
        parent_key=fm.get("parent"),
        icon=fm.get("icon"),
        icon_color=fm.get("icon_color"),
        page_type=fm.get("page_type", "note"),
        session_date=fm.get("session_date"),
    )


def parse_grimoire_bundle(obj: dict) -> list:
    records = []
    for p in obj.get("pages", []):
        records.append(
            _record(
                p.get("title"),
                p.get("body"),
                visibility=p.get("visibility", "gm"),
                parent_key=p.get("parent"),
                icon=p.get("icon"),
                icon_color=p.get("icon_color"),
                page_type=p.get("page_type", "note"),
                session_date=p.get("session_date"),
                source_key=p.get("slug") or p.get("title"),
            )
        )
    return records


def _looks_like_lk_page(obj: dict) -> bool:
    return isinstance(obj, dict) and "name" in obj and "documents" in obj


def lk_to_markdown(html: str, id_to_title: dict) -> str:
    """Convert a LegendKeeper HTML page body to markdown.

    `id_to_title` maps LegendKeeper page ids to titles so internal links
    (`<a href="<id>.html">`) resolve to `[[Title]]`; unknown targets fall back to
    their visible label.
    """
    from markdownify import markdownify

    content = html or ""
    wrap = _LK_WRAP_RE.search(content.strip())
    if wrap:
        content = wrap.group(1)
    content = _LK_SPECIAL_RE.sub("", content)

    md = markdownify(content, heading_style="ATX", bullets="-")

    # markdownify turns <a href="<id>.html">Label</a> into [Label](<id>.html).
    # Rewrite those to [[Title]] / [[Title|Label]] now that bracket-escaping is done.
    def _link(m):
        label = m.group(1).strip()
        target_id = m.group(2).rsplit("/", 1)[-1]
        title = id_to_title.get(target_id) or label
        if not title:
            return label
        if not label or title == label:
            return f"[[{title}]]"
        return f"[[{title}|{label}]]"

    md = _MD_LK_LINK_RE.sub(_link, md)
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def _pm_inline(nodes, id_to_title: dict) -> str:
    """Render an array of ProseMirror inline nodes (text / mention) to markdown."""
    out = []
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        ntype = n.get("type")
        if ntype == "text":
            text = n.get("text", "")
            marks = {m.get("type") for m in n.get("marks", []) if isinstance(m, dict)}
            # Order matters so wrappers nest predictably: code first, then emphasis.
            if "code" in marks:
                text = f"`{text}`"
            if "strong" in marks:
                text = f"**{text}**"
            if "em" in marks:
                text = f"*{text}*"
            link = next(
                (m for m in n.get("marks", []) if isinstance(m, dict) and m.get("type") == "link"),
                None,
            )
            if link:
                href = (link.get("attrs") or {}).get("href", "")
                text = f"[{text}]({href})"
            out.append(text)
        elif ntype == "mention":
            # LK cross-reference to another resource — render as a [[wiki link]].
            attrs = n.get("attrs") or {}
            label = (attrs.get("text") or "").strip()
            target_id = attrs.get("documentId") or attrs.get("id")
            title = id_to_title.get(target_id) or label
            if title:
                out.append(f"[[{title}]]" if title == label or not label else f"[[{title}|{label}]]")
            elif label:
                out.append(label)
        elif ntype == "hardBreak":
            out.append("  \n")
    return "".join(out)


def _pm_table(node, id_to_title: dict) -> str:
    """Render a ProseMirror table node as a GitHub-flavored markdown table.

    Cell content is flattened to a single line (markdown tables can't hold block
    structure); the first row is treated as the header.
    """
    rows = []
    for row in node.get("content", []) or []:
        if not isinstance(row, dict) or row.get("type") != "tableRow":
            continue
        cells = []
        for cell in row.get("content", []) or []:
            if not isinstance(cell, dict):
                continue
            # Flatten each cell's block children into one inline string.
            parts = [
                _pm_inline(block.get("content", []), id_to_title)
                for block in cell.get("content", []) or []
                if isinstance(block, dict)
            ]
            cells.append(" ".join(p for p in parts if p).replace("|", "\\|").strip())
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def _pm_block(node, id_to_title: dict, depth: int = 0) -> str:
    """Render one ProseMirror block node to markdown."""
    if not isinstance(node, dict):
        return ""
    ntype = node.get("type")
    content = node.get("content", []) or []
    if ntype == "paragraph":
        return _pm_inline(content, id_to_title)
    if ntype == "heading":
        level = (node.get("attrs") or {}).get("level", 1)
        return f"{'#' * max(1, min(6, level))} {_pm_inline(content, id_to_title)}"
    if ntype == "blockquote":
        inner = "\n".join(_pm_block(c, id_to_title, depth) for c in content)
        return "\n".join(f"> {line}" for line in inner.splitlines())
    if ntype == "codeBlock":
        lang = (node.get("attrs") or {}).get("language") or ""
        return f"```{lang}\n{_pm_inline(content, id_to_title)}\n```"
    if ntype in ("bulletList", "orderedList"):
        ordered = ntype == "orderedList"
        items = []
        for i, item in enumerate(content, start=1):
            marker = f"{i}." if ordered else "-"
            body = "\n".join(
                _pm_block(c, id_to_title, depth + 1)
                for c in (item.get("content", []) or [])
                if isinstance(c, dict)
            )
            indent = "  " * depth
            first, *rest = body.split("\n") if body else [""]
            lines = [f"{indent}{marker} {first}"]
            lines += [f"{indent}  {r}" for r in rest]
            items.append("\n".join(lines))
        return "\n".join(items)
    if ntype == "table":
        return _pm_table(node, id_to_title)
    if ntype == "horizontalRule":
        return "---"
    # Unknown block: best-effort flatten of any inline children.
    return _pm_inline(content, id_to_title)


def pm_to_markdown(doc, id_to_title: dict) -> str:
    """Convert a ProseMirror document ({"type":"doc","content":[...]}) to markdown."""
    if not isinstance(doc, dict):
        return ""
    blocks = [
        _pm_block(b, id_to_title)
        for b in doc.get("content", []) or []
        if isinstance(b, dict)
    ]
    md = "\n\n".join(b for b in blocks if b.strip())
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def _lk_bundle_id_to_title(resources: list) -> dict:
    """Map a bundle resource id (and its first document id) to the resource title."""
    mapping = {}
    for r in resources:
        if not isinstance(r, dict):
            continue
        title = (r.get("name") or "").strip()
        if r.get("id"):
            mapping[r["id"]] = title
        for doc in r.get("documents", []) or []:
            if isinstance(doc, dict) and doc.get("id"):
                mapping[doc["id"]] = title
    return mapping


def _looks_like_lk_bundle(obj) -> bool:
    return (
        isinstance(obj, dict)
        and isinstance(obj.get("resources"), list)
        and any(_looks_like_lk_resource(r) for r in obj["resources"])
    )


def _looks_like_lk_resource(obj) -> bool:
    return isinstance(obj, dict) and "name" in obj and "documents" in obj and "id" in obj


def parse_lk_bundle(obj: dict) -> list:
    """A LegendKeeper bundle ({"resources":[...]}) → records, preserving hierarchy.

    Each resource's first document holds a ProseMirror body; `parentId` links a
    resource to its container, which we carry as the record's `parent_key`.
    """
    resources = [r for r in obj.get("resources", []) if _looks_like_lk_resource(r)]
    id_to_title = _lk_bundle_id_to_title(resources)
    records = []
    for r in resources:
        if r.get("isHidden"):
            # LK-hidden resources aren't shown to players; skip rather than import.
            continue
        docs = r.get("documents") or []
        doc_content = docs[0].get("content") if docs and isinstance(docs[0], dict) else None
        body = pm_to_markdown(doc_content, id_to_title) if isinstance(doc_content, dict) else ""
        records.append(
            _record(
                r.get("name"),
                body,
                icon=None,
                source_key=r.get("id") or r.get("name"),
                parent_key=r.get("parentId"),
            )
        )
    return records


def parse_lk_pages(objs: list) -> list:
    """LegendKeeper page JSON objects → records (flat; LK hierarchy ignored)."""
    id_to_title = {
        o.get("id"): (o.get("name") or "").strip()
        for o in objs
        if isinstance(o, dict) and o.get("id")
    }
    records = []
    for o in objs:
        if not _looks_like_lk_page(o):
            continue
        docs = o.get("documents") or []
        html = docs[0].get("content", "") if docs and isinstance(docs[0], dict) else ""
        records.append(
            _record(
                o.get("name"),
                lk_to_markdown(html, id_to_title),
                source_key=o.get("id") or o.get("name"),
            )
        )
    return records


# --------------------------------------------------------------------------- #
# Import
# --------------------------------------------------------------------------- #


def _records_from_json_obj(obj) -> tuple:
    """Return (records, format_label) for a parsed JSON payload."""
    if isinstance(obj, dict) and "grimoire_wiki_version" in obj:
        return parse_grimoire_bundle(obj), "grimoire-json"
    if _looks_like_lk_bundle(obj):
        return parse_lk_bundle(obj), "legendkeeper"
    if isinstance(obj, list) and obj and all(_looks_like_lk_page(o) for o in obj):
        return parse_lk_pages(obj), "legendkeeper"
    if _looks_like_lk_page(obj):
        return parse_lk_pages([obj]), "legendkeeper"
    raise HTTPException(400, "Unrecognised JSON format")


def _records_from_zip(data: bytes) -> tuple:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "File is not a valid zip archive")

    md_records, lk_objs = [], []
    bundle = None
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            fn = info.filename
            base = fn.rsplit("/", 1)[-1].lower()
            if base.startswith(".") or base == "index.json":
                continue
            raw = zf.read(info)
            if base.endswith((".md", ".markdown", ".txt")):
                md_records.append(parse_markdown_file(fn, raw.decode("utf-8", "replace")))
            elif base.endswith(".json"):
                try:
                    obj = json.loads(raw.decode("utf-8", "replace"))
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and "grimoire_wiki_version" in obj:
                    bundle = obj
                elif _looks_like_lk_bundle(obj):
                    return parse_lk_bundle(obj), "legendkeeper"
                elif _looks_like_lk_page(obj):
                    lk_objs.append(obj)

    if md_records:
        return md_records, "markdown"
    if lk_objs:
        return parse_lk_pages(lk_objs), "legendkeeper"
    if bundle is not None:
        return parse_grimoire_bundle(bundle), "grimoire-json"
    raise HTTPException(400, "Zip contains no importable wiki files")


def _parse_upload(filename: str, data: bytes) -> tuple:
    name = (filename or "").lower()
    if name.endswith(".zip") or data[:2] == b"PK":
        return _records_from_zip(data)
    if name.endswith((".md", ".markdown", ".txt")):
        return [parse_markdown_file(filename, data.decode("utf-8", "replace"))], "markdown"
    # Default (incl. .lk, which LegendKeeper exports as a JSON bundle): JSON.
    try:
        obj = json.loads(data.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        raise HTTPException(400, "File is not valid JSON, markdown, or a zip archive")
    return _records_from_json_obj(obj)


# [[target]] / [[target|label]] for link remapping (embeds left untouched).
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]")
_EMBED_PREFIXES = ("book:", "map:", "token:", "audio:")


def _remap_links(body: str, key_to_title: dict) -> str:
    """Rewrite [[target]] whose target is a foreign source_key to the page title we
    assigned it, so links survive even when titles collide and get a `-2` slug.

    Only the *title* part of the target is remapped; a `:#Heading` suffix is
    preserved. An incoming `:id-` pin is dropped: it refers to a page id from the
    source campaign, and every imported page is assigned a fresh id here, so
    keeping it would leave a permanently broken pin. The title (which we do remap)
    is the only identity that survives an import.
    """
    def repl(m):
        target, label = m.group(1).strip(), m.group(2)
        if target.lower().startswith(_EMBED_PREFIXES):
            return m.group(0)
        link = parse_target(target)
        # Match on the bare title first, then the whole raw target so exports that
        # used a source_key containing ":" still remap.
        new_title = key_to_title.get(link.title) or key_to_title.get(target)
        if not new_title:
            # Not a foreign key we know: still strip a now-meaningless id pin.
            if not link.page_id:
                return m.group(0)
            new_title = link.title
        elif new_title == target and not link.page_id:
            return m.group(0)
        new_target = build_target(new_title, None, link.heading)
        return f"[[{new_target}|{label.strip()}]]" if label else f"[[{new_target}]]"

    return _WIKILINK_RE.sub(repl, body or "")


def _order_parents_first(records: list) -> list:
    """Return records sorted so a record's parent precedes it.

    Parent links are by `parent_key` -> some record's `source_key`. Records whose
    parent_key names no record in the set are treated as roots (the LK container
    they pointed at wasn't exported). Any cycle is broken by falling back to input
    order for the records left over.
    """
    by_key = {r["source_key"]: r for r in records}
    ordered = []
    placed = set()

    def place(rec, stack):
        rid = id(rec)
        if rid in placed or rid in stack:
            return
        parent = by_key.get(rec["parent_key"]) if rec["parent_key"] else None
        if parent is not None and parent is not rec:
            place(parent, stack | {rid})
        if rid not in placed:
            ordered.append(rec)
            placed.add(rid)

    for rec in records:
        place(rec, set())
    return ordered


def import_wiki(
    campaign_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import wiki pages from a markdown / JSON / LegendKeeper file (owner only)."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    data = file.file.read(_MAX_IMPORT_BYTES + 1)
    if len(data) > _MAX_IMPORT_BYTES:
        raise HTTPException(413, "File is too large")
    if not data:
        raise HTTPException(400, "Empty file")

    records, fmt = _parse_upload(file.filename, data)
    if not records:
        raise HTTPException(400, "No pages found to import")

    # Map every foreign source_key to the final title we assign, so internal
    # links remap correctly even when an import-set title collides with itself.
    key_to_title: dict = {}
    for rec in records:
        key_to_title[rec["source_key"]] = rec["title"]

    # Create parents before children so each child can reference its parent's id.
    key_to_id: dict = {}
    created = []
    for rec in _order_parents_first(records):
        parent_id = key_to_id.get(rec["parent_key"]) if rec["parent_key"] else None
        page = WikiPage(
            campaign_id=campaign_id,
            title=rec["title"],
            slug=_ensure_unique_slug(db, campaign_id, slugify(rec["title"])),
            body=_remap_links(rec["body"], key_to_title),
            visibility=rec["visibility"],
            page_type=rec["page_type"],
            session_date=rec["session_date"],
            icon=rec["icon"],
            icon_color=rec["icon_color"],
            parent_id=parent_id,
            created_by_id=current_user.id,
        )
        db.add(page)
        db.flush()
        key_to_id[rec["source_key"]] = page.id
        created.append(page)

    # Rebuild links after all pages exist so cross-references resolve to real
    # targets instead of spawning stubs.
    for page in created:
        rebuild_links(db, c, page, current_user)

    db.commit()
    for page in created:
        db.refresh(page)
    return {
        "imported": len(created),
        "format": fmt,
        "pages": [_page_summary(p) for p in created],
    }

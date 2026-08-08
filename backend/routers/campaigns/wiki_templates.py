"""Campaign wiki note templates.

A note template is a reusable starting point for a wiki page, owned by one
campaign (``WikiTemplate``). Templates are small markdown files, so every
campaign keeps its own copies and a GM can edit one freely without affecting
anyone else's.

A template gets into a campaign three ways:

  * **Downloaded** from a community catalogue (see
    ``services/wiki_template_catalogue.py``). Off when
    ``WIKI_TEMPLATES_DOWNLOAD_DISABLED`` is set.
  * **Uploaded** as a ``.md`` file — which is how a GM on a server with
    downloading disabled can still use a community template, by copying the
    file across by hand.
  * **Written** in the app.

Using a template creates a wiki page from its body. The body is
markdown-with-frontmatter, exactly what the wiki importer already parses, so
that is a thin wrapper over ``wiki_io`` rather than a second parser. Creating a
page is non-destructive, as everywhere else in the wiki: a new page with a
unique slug, never an overwrite.

Templates are also **exportable** as a folder (a `.zip` of `<id>.yml` +
`<id>.md`), so a GM can contribute one back to the community repo or keep their
own fork.
"""
import io
import json
import re
import zipfile
from typing import Optional

import yaml
from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import GameSystem, WikiPage, WikiTemplate
from ...services import wiki_template_catalogue as catalogue
from ._frontmatter import (
    clean_page_type,
    clean_visibility,
    compose,
    split_frontmatter,
)
from ._helpers import assert_can_manage, get_campaign_or_404
from ._schemas import (
    WikiTemplateDefaults,
    WikiTemplateInput,
    WikiTemplateSourceInput,
    WikiTemplateUpdate,
)
from .wiki import _ensure_unique_slug, _page_summary, rebuild_links, slugify
from .wiki_io import _remap_links, parse_markdown_file

# A template body is a markdown page; bound the upload so one request cannot
# hand us an unbounded string to store.
_MAX_UPLOAD_BYTES = 512 * 1024

# Export filenames are built from this, so it stays strict.
_SAFE_ID_RE = re.compile(r"[^a-z0-9]+")

# Stored in `system` for a template the GM wrote themselves. A game system is
# meaningless for one of those, and an empty string would be indistinguishable
# from a community template that simply didn't declare one — this says which it
# is, and the client renders it as "Created by you".
AUTHORED_SYSTEM = "__authored__"

# Categories offered in the editor's dropdown before a GM adds their own. These
# mirror the ones the community catalogue uses, so a hand-written template files
# alongside downloaded ones instead of starting a category of one.
SUGGESTED_CATEGORIES = (
    "Characters",
    "Encounters",
    "Factions",
    "Items",
    "Locations",
    "Quests",
    "Sessions",
    "Spells",
    "General",
)


def _compose_body(defaults: Optional[WikiTemplateDefaults], body: Optional[str]) -> str:
    """The stored body: the page defaults as frontmatter, then the markdown.

    ``compose`` strips any block already on ``body`` first, so a client that
    round-trips a full document back to us cannot stack two blocks up.

    When no ``defaults`` are sent, any frontmatter the body already carries is
    kept as-is — that is how a pasted or uploaded document keeps its page
    defaults instead of silently losing them.
    """
    if defaults is None:
        existing, _ = split_frontmatter(body or "")
        fields = dict(existing)
    else:
        fields = defaults.model_dump()
    if fields.get("visibility"):
        fields["visibility"] = clean_visibility(fields["visibility"])
    if fields.get("page_type"):
        fields["page_type"] = clean_page_type(fields["page_type"])
    return compose(fields, body or "")


def _summary(t: WikiTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "system": t.system or "",
        "category": t.category or "General",
        "description": t.description or "",
        "source_id": t.source_id,
        "source_url": t.source_url,
        "source_version": t.source_version,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _detail(t: WikiTemplate) -> dict:
    """One template, with its frontmatter split out into page-default fields.

    The editor shows those as form controls rather than raw YAML, so `body` here
    is the markdown *without* its frontmatter block and `defaults` carries what
    the block held. A template whose body has no frontmatter simply reports
    empty defaults.
    """
    fields, body = split_frontmatter(t.body or "")
    return {
        **_summary(t),
        "body": body,
        "defaults": {
            "title": fields.get("title", ""),
            "icon": fields.get("icon", ""),
            "icon_color": fields.get("icon_color", ""),
            "visibility": clean_visibility(fields.get("visibility")),
            "page_type": clean_page_type(fields.get("page_type")),
        },
    }


def _get_template_or_404(db: Session, campaign_id: str, template_id: str) -> WikiTemplate:
    """One of *this campaign's* templates. Scoped by campaign so a template id
    from another campaign is a 404 rather than a cross-campaign read."""
    t = (
        db.query(WikiTemplate)
        .filter_by(id=template_id, campaign_id=campaign_id)
        .first()
    )
    if not t:
        raise HTTPException(404, "Template not found")
    return t


def _campaign_system(db: Session, c) -> str:
    """The campaign's game-system name: the linked system's, else the free-text
    one. Mirrors ``_campaign_payload``; may be empty."""
    if c.system_id:
        sys_obj = db.query(GameSystem).filter_by(id=c.system_id).first()
        if sys_obj:
            return sys_obj.name
    return c.system_name or ""


# --------------------------------------------------------------------------- #
# The campaign's own templates
# --------------------------------------------------------------------------- #


def list_wiki_templates(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """This campaign's templates, plus what the server allows.

    Owner-only, matching import: everything on this list exists to write a page.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    rows = (
        db.query(WikiTemplate)
        .filter_by(campaign_id=campaign_id)
        .order_by(WikiTemplate.sort_order, WikiTemplate.name)
        .all()
    )
    # Categories the editor offers: the suggested set plus whatever this
    # campaign already uses, so a GM's own category shows up next time.
    used = {(t.category or "").strip() for t in rows}
    categories = sorted(
        {name for name in used if name} | set(SUGGESTED_CATEGORIES), key=str.lower
    )

    return {
        "templates": [_summary(t) for t in rows],
        "campaign_system": _campaign_system(db, c),
        # Drives whether the browser offers the "browse community" tab at all.
        "downloads_enabled": catalogue.downloads_enabled(),
        "categories": categories,
        # Lets the client label a hand-written template without hard-coding the
        # sentinel value.
        "authored_system": AUTHORED_SYSTEM,
    }


def get_wiki_template(
    campaign_id: str,
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One template including its body — the editor's read."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    return _detail(_get_template_or_404(db, campaign_id, template_id))


def create_wiki_template(
    campaign_id: str,
    data: WikiTemplateInput,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Write a new template by hand (owner only).

    Page defaults (title/icon/visibility/…) arrive as fields and are stored as a
    frontmatter block on the body, which is the same shape a downloaded or
    uploaded template has — so all three kinds round-trip identically.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    t = WikiTemplate(
        campaign_id=campaign_id,
        name=data.name.strip(),
        # A hand-written template has no game system to speak of; the marker
        # tells the browser to label it as the GM's own rather than showing a
        # meaningless blank or a system it was never written for.
        system=AUTHORED_SYSTEM,
        category=(data.category or "").strip(),
        description=(data.description or "").strip(),
        body=_compose_body(data.defaults, data.body),
        created_by_id=current_user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _detail(t)


def update_wiki_template(
    campaign_id: str,
    template_id: str,
    data: WikiTemplateUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit a template. Every field is optional; only what is sent changes."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    t = _get_template_or_404(db, campaign_id, template_id)

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        t.name = name
    for field in ("category", "description"):
        value = getattr(data, field)
        if value is not None:
            setattr(t, field, value.strip())

    # Body and defaults are two halves of one stored string, so a change to
    # either rebuilds it — from the *current* values of the half not being sent,
    # so a body-only edit keeps the defaults and vice versa.
    if data.body is not None or data.defaults is not None:
        current_fields, current_body = split_frontmatter(t.body or "")
        body = current_body if data.body is None else data.body
        defaults = data.defaults if data.defaults is not None else (
            WikiTemplateDefaults(**current_fields)
        )
        t.body = _compose_body(defaults, body)

    db.commit()
    db.refresh(t)
    return _detail(t)


def delete_wiki_template(
    campaign_id: str,
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    db.delete(_get_template_or_404(db, campaign_id, template_id))
    db.commit()
    return Response(status_code=204)


def upload_wiki_template(
    campaign_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a template from an uploaded ``.md`` or ``.zip`` (owner only).

    Two shapes are accepted:

      * A bare markdown file — the frontmatter names the template, falling back
        to the filename.
      * A `.zip` in the community repo's folder layout (`<id>/<id>.yml` plus
        `<id>/<id>.md`), which is exactly what *export* produces. The manifest
        supplies name/category/description, so a template survives an
        export/import round trip with its metadata intact.

    Deliberately available even when downloading is disabled: that is how a GM
    on a locked-down server uses a community template — copy the files across
    and upload them.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    filename = file.filename or ""
    lowered = filename.lower()

    data = file.file.read(_MAX_UPLOAD_BYTES + 1)
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That file is too large")
    if not data:
        raise HTTPException(400, "Empty file")

    # Sniff the magic bytes as well as the extension: a `.zip` renamed to `.md`
    # would otherwise be stored as a body of binary noise.
    if lowered.endswith(".zip") or data[:2] == b"PK":
        fields = _template_from_zip(data)
    elif lowered.endswith((".md", ".markdown", ".txt")):
        body = data.decode("utf-8", "replace")
        # The frontmatter title names the template, falling back to the filename.
        record = parse_markdown_file(filename or "template.md", body)
        fields = {"name": record["title"], "body": body}
    else:
        raise HTTPException(400, "Upload a Markdown (.md) file or a template .zip")

    t = WikiTemplate(
        campaign_id=campaign_id,
        name=fields["name"],
        body=fields["body"],
        category=fields.get("category", ""),
        description=fields.get("description", ""),
        created_by_id=current_user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _detail(t)


def _template_from_zip(data: bytes) -> dict:
    """Read a template out of a `.zip` in the community repo's folder layout.

    Looks for one `.md` (the body) and, optionally, a `.yml`/`.yaml` manifest
    beside it. The archive comes from a user, so nothing in it is trusted: entry
    names are only ever *matched*, never used as paths, sizes are checked before
    reading, and a manifest that isn't a plain mapping is ignored rather than
    fatal.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "That file is not a valid zip archive") from exc

    body_name = None
    manifest_name = None
    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            base = info.filename.rsplit("/", 1)[-1].lower()
            # Skip dotfiles and the macOS resource-fork directory, which would
            # otherwise win the "first .md" race in a zip made on a Mac.
            if base.startswith(".") or info.filename.startswith("__MACOSX/"):
                continue
            # Guard against a zip bomb: refuse before decompressing.
            if info.file_size > _MAX_UPLOAD_BYTES:
                raise HTTPException(413, "A file in that archive is too large")
            if body_name is None and base.endswith((".md", ".markdown")):
                body_name = info.filename
            elif manifest_name is None and base.endswith((".yml", ".yaml")):
                manifest_name = info.filename

        if body_name is None:
            raise HTTPException(400, "That archive has no Markdown file in it")

        body = archive.read(body_name).decode("utf-8", "replace")
        manifest_raw = archive.read(manifest_name) if manifest_name else b""

    fields: dict = {"body": body}
    if manifest_raw:
        try:
            parsed = yaml.safe_load(manifest_raw.decode("utf-8", "replace"))
        except yaml.YAMLError:
            parsed = None
        if isinstance(parsed, dict):
            for key in ("name", "category", "description"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    fields[key] = value.strip()[:255]

    if not fields.get("name"):
        # No usable manifest: fall back to the body's frontmatter title, then
        # the markdown file's own name — the same rule a bare .md upload uses.
        record = parse_markdown_file(body_name.rsplit("/", 1)[-1], body)
        fields["name"] = record["title"]
    return fields


def export_wiki_template(
    campaign_id: str,
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download a template as the folder the community repo expects.

    A `.zip` holding ``<id>/<id>.yml`` and ``<id>/<id>.md`` — drop it into a
    fork of the community repo, or keep it as a backup.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    t = _get_template_or_404(db, campaign_id, template_id)

    # The community id must be a safe directory name. Prefer the id it was
    # downloaded under so a round trip keeps its identity.
    slug = t.source_id or _SAFE_ID_RE.sub("-", (t.name or "template").lower()).strip("-")
    slug = slug or "template"

    manifest_lines = [
        f"id: {slug}",
        f"name: {_yaml_scalar(t.name or slug)}",
        f"version: {t.source_version or '1.0.0'}",
        "kind: note-template",
    ]
    if t.system:
        manifest_lines.append(f"system: {_yaml_scalar(t.system)}")
    if t.category:
        manifest_lines.append(f"category: {_yaml_scalar(t.category)}")
    if t.description:
        manifest_lines.append(f"description: {_yaml_scalar(t.description)}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{slug}/{slug}.yml", "\n".join(manifest_lines) + "\n")
        zf.writestr(f"{slug}/{slug}.md", (t.body or "").rstrip("\n") + "\n")

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{slug}.zip"'},
    )


def _yaml_scalar(value: str) -> str:
    """Quote a scalar if a YAML parser could misread it. Mirrors wiki_io."""
    s = value or ""
    if s == "" or re.search(r"[:#\[\]{}&*!|>'\"%@`]", s) or s.strip() != s:
        return json.dumps(s)
    return s


# --------------------------------------------------------------------------- #
# Using a template
# --------------------------------------------------------------------------- #


def use_wiki_template(
    campaign_id: str,
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a wiki page from one of this campaign's templates (owner only)."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    t = _get_template_or_404(db, campaign_id, template_id)

    # The body is markdown-with-frontmatter, so the importer's parser gives us
    # the title/icon/visibility handling (and its sanitising) for free.
    record = parse_markdown_file(f"{t.name}.md", t.body or "")
    title = record["title"] or t.name or "Untitled"

    page = WikiPage(
        campaign_id=campaign_id,
        title=title,
        slug=_ensure_unique_slug(db, campaign_id, slugify(title)),
        # No foreign keys to remap, but this also strips the now-meaningless
        # page-id pins a [[link]] in a community template might carry.
        body=_remap_links(record["body"], {}),
        visibility=record["visibility"],
        page_type=record["page_type"],
        icon=record["icon"],
        icon_color=record["icon_color"],
        created_by_id=current_user.id,
    )
    db.add(page)
    db.flush()

    rebuild_links(db, c, page, current_user)
    db.commit()
    db.refresh(page)
    # Same shape as the file importer, so the client treats both alike.
    return {"imported": 1, "template_id": template_id, "pages": [_page_summary(page)]}


# --------------------------------------------------------------------------- #
# The community catalogue
# --------------------------------------------------------------------------- #


def browse_wiki_templates(
    campaign_id: str,
    refresh: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The community catalogue, as a folder tree.

    A dead or unreachable catalogue is reported as a 502 with the underlying
    message, so the browser can say "couldn't reach it" rather than failing
    opaquely — the rest of the wiki is unaffected.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    if not catalogue.downloads_enabled():
        raise HTTPException(403, "Downloading note templates is disabled on this server")

    try:
        doc = catalogue.fetch_catalogue(db, force=refresh)
    except catalogue.TemplateCatalogueError as exc:
        raise HTTPException(502, str(exc)) from exc

    # Which community templates this campaign already has, so the browser can
    # mark them rather than silently creating a duplicate.
    owned = {
        t.source_id
        for t in db.query(WikiTemplate).filter_by(campaign_id=campaign_id).all()
        if t.source_id
    }
    return {
        "folders": catalogue.build_tree(doc),
        "downloaded_ids": sorted(owned),
        "campaign_system": _campaign_system(db, c),
        "index_url": catalogue.get_index_url(db),
        "is_custom_url": catalogue.is_custom_url(db),
        "generated": doc.get("generated", ""),
    }


def download_wiki_template(
    campaign_id: str,
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy a community template into this campaign (owner only).

    Downloading the same template twice is allowed and makes a second copy —
    templates are per-campaign working copies, and a GM may well want a tweaked
    variant alongside the original.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    if not catalogue.downloads_enabled():
        raise HTTPException(403, "Downloading note templates is disabled on this server")

    try:
        doc = catalogue.fetch_catalogue(db)
        entry = catalogue.find_entry(doc, template_id)
        if entry is None:
            raise HTTPException(404, "That template is not in the catalogue")
        body = catalogue.fetch_body(db, entry)
    except catalogue.TemplateCatalogueError as exc:
        raise HTTPException(502, str(exc)) from exc

    t = WikiTemplate(
        campaign_id=campaign_id,
        name=str(entry.get("name") or template_id)[:255],
        system=str(entry.get("system") or "")[:255],
        category=str(entry.get("category") or "")[:255],
        description=str(entry.get("description") or ""),
        body=body,
        source_id=template_id[:100],
        source_url=catalogue.get_index_url(db),
        source_version=str(entry.get("version") or "")[:20],
        created_by_id=current_user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _detail(t)


def update_template_source(
    campaign_id: str,
    data: WikiTemplateSourceInput,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Point the browser at a different catalogue (owner only).

    Sending an empty string restores the built-in default, which is what the
    UI's "reset" does.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    try:
        catalogue.set_index_url(db, data.index_url or "")
    except catalogue.TemplateCatalogueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return {
        "index_url": catalogue.get_index_url(db),
        "is_custom_url": catalogue.is_custom_url(db),
    }

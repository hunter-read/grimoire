"""Export endpoint handlers — admin-only data exports."""
import datetime
import json

from fastapi import Depends
from sqlalchemy.orm import Session
from fastapi.responses import Response

from ...auth import CurrentUser, require_admin
from ...config import get_db
from ...models import (
    Audio,
    AudioFolder,
    Book,
    BookFolder,
    GameSystem,
    GenericMap,
    MapFolder,
    Token,
    TokenFolder,
)
from ...services import tag_service


def export_tags(
    include_library: bool = True,
    include_maps: bool = True,
    include_tokens: bool = True,
    include_audio: bool = True,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    exported_at = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    payload: dict = {"exported_at": exported_at}

    if include_library:
        system_rows = db.query(GameSystem).order_by(GameSystem.name).all()
        system_tags = tag_service.display_tags_for_resources(
            db, "system", [s.id for s in system_rows]
        )
        systems = [
            {"slug": s.slug, "name": s.name, "tags": system_tags.get(s.id, [])}
            for s in system_rows
        ]
        book_rows = db.query(Book).order_by(Book.title).all()
        book_tags = tag_service.display_tags_for_resources(db, "book", [b.id for b in book_rows])
        books = [
            {
                "id": b.id,
                "title": b.title,
                "filepath": b.relative_path,
                "tags": book_tags.get(b.id, []),
            }
            for b in book_rows
        ]
        book_folders = [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in db.query(BookFolder).order_by(BookFolder.path).all()
        ]
        payload["library"] = {
            "systems": systems,
            "books": books,
            "book_folders": book_folders,
        }

    if include_maps:
        map_rows = db.query(GenericMap).order_by(GenericMap.filename).all()
        map_tags = tag_service.display_tags_for_resources(db, "map", [m.id for m in map_rows])
        maps = [
            {
                "id": m.id,
                "name": m.filename,
                "folder": "/".join(m.relative_path.split("/")[:-1]),
                "tags": map_tags.get(m.id, []),
            }
            for m in map_rows
        ]
        map_folders = [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in db.query(MapFolder).order_by(MapFolder.path).all()
        ]
        payload["maps"] = {"items": maps, "folders": map_folders}

    if include_tokens:
        token_rows = db.query(Token).order_by(Token.filename).all()
        token_tags = tag_service.display_tags_for_resources(
            db, "token", [t.id for t in token_rows]
        )
        tokens = [
            {
                "id": t.id,
                "name": t.filename,
                "folder": "/".join(t.relative_path.split("/")[:-1]),
                "tags": token_tags.get(t.id, []),
            }
            for t in token_rows
        ]
        token_folders = [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in db.query(TokenFolder).order_by(TokenFolder.path).all()
        ]
        payload["tokens"] = {"items": tokens, "folders": token_folders}

    if include_audio:
        audio_rows = db.query(Audio).order_by(Audio.filename).all()
        audio_tags = tag_service.display_tags_for_resources(
            db, "audio", [a.id for a in audio_rows]
        )
        audio = [
            {
                "id": a.id,
                "name": a.filename,
                "folder": "/".join(a.relative_path.split("/")[:-1]),
                "tags": audio_tags.get(a.id, []),
            }
            for a in audio_rows
        ]
        audio_folders = [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in db.query(AudioFolder).order_by(AudioFolder.path).all()
        ]
        payload["audio"] = {"items": audio, "folders": audio_folders}

    date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    filename = f"grimoire-tags-{date_str}.json"
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

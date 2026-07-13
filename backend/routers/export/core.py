"""Export endpoint handlers — admin-only data exports."""
import datetime
import json

from fastapi import Depends
from fastapi.responses import Response

from ...auth import CurrentUser, require_admin
from ...config import SessionLocal
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


def export_tags(
    include_library: bool = True,
    include_maps: bool = True,
    include_tokens: bool = True,
    include_audio: bool = True,
    _: CurrentUser = Depends(require_admin),
):
    db = SessionLocal()
    try:
        exported_at = datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        payload: dict = {"exported_at": exported_at}

        if include_library:
            systems = [
                {"slug": s.slug, "name": s.name, "tags": s.tags or []}
                for s in db.query(GameSystem).order_by(GameSystem.name).all()
            ]
            books = [
                {
                    "id": b.id,
                    "title": b.title,
                    "filepath": b.relative_path,
                    "tags": b.tags or [],
                }
                for b in db.query(Book).order_by(Book.title).all()
            ]
            book_folders = [
                {"path": f.path, "tags": f.tags or []}
                for f in db.query(BookFolder).order_by(BookFolder.path).all()
            ]
            payload["library"] = {
                "systems": systems,
                "books": books,
                "book_folders": book_folders,
            }

        if include_maps:
            maps = [
                {
                    "id": m.id,
                    "name": m.filename,
                    "folder": "/".join(m.relative_path.split("/")[:-1]),
                    "tags": m.tags or [],
                }
                for m in db.query(GenericMap).order_by(GenericMap.filename).all()
            ]
            map_folders = [
                {"path": f.path, "tags": f.tags or []}
                for f in db.query(MapFolder).order_by(MapFolder.path).all()
            ]
            payload["maps"] = {"items": maps, "folders": map_folders}

        if include_tokens:
            tokens = [
                {
                    "id": t.id,
                    "name": t.filename,
                    "folder": "/".join(t.relative_path.split("/")[:-1]),
                    "tags": t.tags or [],
                }
                for t in db.query(Token).order_by(Token.filename).all()
            ]
            token_folders = [
                {"path": f.path, "tags": f.tags or []}
                for f in db.query(TokenFolder).order_by(TokenFolder.path).all()
            ]
            payload["tokens"] = {"items": tokens, "folders": token_folders}

        if include_audio:
            audio = [
                {
                    "id": a.id,
                    "name": a.filename,
                    "folder": "/".join(a.relative_path.split("/")[:-1]),
                    "tags": a.tags or [],
                }
                for a in db.query(Audio).order_by(Audio.filename).all()
            ]
            audio_folders = [
                {"path": f.path, "tags": f.tags or []}
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
    finally:
        db.close()

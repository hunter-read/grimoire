"""Export router — admin-only data export endpoints."""

import json
import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from ..config import SessionLocal
from ..auth import require_admin, CurrentUser
from ..models import GameSystem, Book, BookFolder, GenericMap, MapFolder, Token, TokenFolder

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/tags", summary="Export all tag data as JSON")
def export_tags(
    include_library: bool = True,
    include_maps: bool = True,
    include_tokens: bool = True,
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

        date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        filename = f"grimoire-tags-{date_str}.json"
        return Response(
            content=json.dumps(payload, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        db.close()

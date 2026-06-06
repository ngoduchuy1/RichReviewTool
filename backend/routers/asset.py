from fastapi import APIRouter, UploadFile, File, Query
from ..database import db_cursor
from ..config import DATA_DIR
from ..services.asset_manager import scan_assets, get_recent, search, get_asset_subtree
from pathlib import Path

router = APIRouter()

ASSET_CATEGORIES = {
    "videos": ["raw", "edited", "exported"],
    "audio": ["music", "voice", "effects"],
    "subtitle": ["source", "translate"],
    "branding": ["logos", "watermarks", "qr"],
    "templates": [],
}


@router.get("/browse")
def browse_assets(category: str = None, subcategory: str = None):
    base = DATA_DIR / "downloads"
    base.mkdir(exist_ok=True)
    if category and subcategory:
        target = base / category / subcategory
    elif category:
        target = base / category
    else:
        target = base

    target.mkdir(parents=True, exist_ok=True)
    items = []
    for f in sorted(target.iterdir()):
        items.append({
            "name": f.name,
            "path": str(f),
            "type": "folder" if f.is_dir() else "file",
            "size": f.stat().st_size if f.is_file() else 0,
            "ext": f.suffix if f.is_file() else "",
        })
    return {
        "category": category or "root",
        "subcategory": subcategory or "",
        "items": items,
    }


@router.get("/categories")
def list_categories():
    return ASSET_CATEGORIES


@router.get("/counts")
def asset_counts():
    """Return asset counts for sidebar display."""
    assets = scan_assets()
    counts = {}
    for cat, items in assets.items():
        counts[cat] = len(items)
    return counts


@router.get("/tree")
def asset_tree():
    """Return nested folder tree for asset sidebar."""
    return get_asset_subtree()


@router.get("/recent")
def recent_assets(limit: int = Query(20)):
    return get_recent(limit)


@router.get("/search")
def search_assets(q: str = Query(""), category: str = None):
    return search(q, category)


@router.post("/upload")
async def upload_asset(category: str, subcategory: str, file: UploadFile = File(...)):
    target = DATA_DIR / "downloads" / category / subcategory
    target.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    out = target / file.filename
    out.write_bytes(content)
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO assets (type, name, path, size) VALUES (?,?,?,?)",
            (category, file.filename, str(out), len(content)),
        )
    return {"path": str(out), "id": cur.lastrowid}

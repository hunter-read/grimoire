import sys
sys.path.append('.')
from backend.config import SessionLocal
from backend.addons.install import _index_entries, get_cached_index
db = SessionLocal()
cached = get_cached_index(db)
addons = cached.get('addons', [])
if not addons:
    print("No addons in cache")
else:
    print(f"First addon: {addons[0].get('index_url')}")
    entries = _index_entries(db)
    if entries:
        print(f"First entry index_url: {entries[0].index_url}")

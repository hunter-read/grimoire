"""Shared helpers and defaults for settings endpoints."""
from ...config import SessionLocal
from ...models import AppSetting


_VALID_INTERVALS = ("hourly", "daily", "weekly")

_DEFAULTS = {
    "rescan_schedule_enabled": "false",
    "rescan_schedule_interval": "daily",
    "rescan_schedule_hour": "2",
    "rescan_schedule_minute": "0",
    "rescan_schedule_weekday": "0",  # 0=Mon … 6=Sun
    "stats_api_key": "",
    "hide_maps": "false",
    "hide_tokens": "false",
    "hide_campaigns": "false",
    # Sidebar stats visibility (true = shown)
    "show_stat_systems": "true",
    "show_stat_books": "false",
    "show_stat_pages": "true",
    "show_stat_maps": "false",
    "show_stat_tokens": "false",
    "show_stat_size": "true",
}


def _get_raw(db) -> dict:
    """Return all settings as a string dict, falling back to defaults."""
    rows = {r.key: r.value for r in db.query(AppSetting).all()}
    return {**_DEFAULTS, **rows}


def _set(db, key: str, value: str) -> None:
    row = db.query(AppSetting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def _to_typed(raw: dict) -> dict:
    return {
        "rescan_schedule_enabled": raw["rescan_schedule_enabled"] == "true",
        "rescan_schedule_interval": raw["rescan_schedule_interval"],
        "rescan_schedule_hour": int(raw.get("rescan_schedule_hour", "2")),
        "rescan_schedule_minute": int(raw.get("rescan_schedule_minute", "0")),
        "rescan_schedule_weekday": int(raw.get("rescan_schedule_weekday", "0")),
        "stats_api_key": raw["stats_api_key"],
        "hide_maps": raw["hide_maps"] == "true",
        "hide_tokens": raw["hide_tokens"] == "true",
        "hide_campaigns": raw["hide_campaigns"] == "true",
        "show_stat_systems": raw["show_stat_systems"] == "true",
        "show_stat_books": raw["show_stat_books"] == "true",
        "show_stat_pages": raw["show_stat_pages"] == "true",
        "show_stat_maps": raw["show_stat_maps"] == "true",
        "show_stat_tokens": raw["show_stat_tokens"] == "true",
        "show_stat_size": raw["show_stat_size"] == "true",
    }


def get_stats_api_key(db) -> str:
    """Return the current stats API key (empty string = disabled)."""
    row = db.query(AppSetting).filter_by(key="stats_api_key").first()
    return row.value if row else ""

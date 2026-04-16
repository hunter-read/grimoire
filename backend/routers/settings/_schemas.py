"""Pydantic schemas for the settings API."""
from typing import Optional
from pydantic import BaseModel


class SettingsPatch(BaseModel):
    rescan_schedule_enabled: Optional[bool] = None
    rescan_schedule_interval: Optional[str] = None
    rescan_schedule_hour: Optional[int] = None
    rescan_schedule_minute: Optional[int] = None
    rescan_schedule_weekday: Optional[int] = None
    stats_api_key: Optional[str] = None  # set to "" to clear
    hide_maps: Optional[bool] = None
    hide_tokens: Optional[bool] = None
    hide_campaigns: Optional[bool] = None
    show_stat_systems: Optional[bool] = None
    show_stat_books: Optional[bool] = None
    show_stat_pages: Optional[bool] = None
    show_stat_maps: Optional[bool] = None
    show_stat_tokens: Optional[bool] = None
    show_stat_size: Optional[bool] = None

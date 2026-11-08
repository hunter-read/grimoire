"""An army as plain text: the list a tournament organiser or opponent asks for."""
from __future__ import annotations

from typing import Any, Optional


def _cost(unit: dict[str, Any], cost_name: str) -> int:
    return sum(c.get("value", 0) for c in unit.get("costs") or [] if c.get("name") == cost_name)


def _total(unit: dict[str, Any], cost_name: str) -> int:
    return _cost(unit, cost_name) + sum(_total(c, cost_name) for c in unit.get("children") or [])


def _lines(units: list[dict[str, Any]], cost_name: str, depth: int) -> list[str]:
    out: list[str] = []
    for unit in units:
        count = f"{unit['number']}x " if unit.get("number", 1) > 1 else ""
        if depth == 0:
            out.append(f"{count}{unit.get('name', '')} [{_total(unit, cost_name)} {cost_name}]")
        else:
            out.append(f"{'  ' * depth}- {count}{unit.get('name', '')}")
        out.extend(_lines(unit.get("children") or [], cost_name, depth + 1))
    return out


def _force(force: dict[str, Any], cost_name: str) -> list[str]:
    title = " - ".join(p for p in (force.get("name"), force.get("catalogue")) if p)
    lines = [f"== {title} ==" if title else "=="]
    lines.extend(_lines(force.get("units") or [], cost_name, 0))
    for nested in force.get("forces") or []:
        lines.append("")
        lines.extend(_force(nested, cost_name))
    return lines


def army_text(
    name: str,
    data: dict[str, Any],
    points: int,
    points_limit: Optional[int],
    cost_name: str,
    system_name: str = "",
) -> str:
    """The army as a readable list, units with their points and upgrades below."""
    total = f"{points}/{points_limit}" if points_limit else str(points)
    lines = [f"{name} ({total} {cost_name})"]
    if system_name:
        lines.append(system_name)
    for force in data.get("forces") or []:
        lines.append("")
        lines.extend(_force(force, cost_name))
    return "\n".join(lines) + "\n"

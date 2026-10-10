"""DiceCloud v1 → Grimoire character payload.

Registered as import source id ``dicecloud-v1`` for D&D 5e sheets that declare
it under ``import_sources``. Fetches via the v1 JSON API (``?key=``); configure
``DICECLOUD_API_KEY`` or pass ``api_key`` on the import-from-url request.
"""

from __future__ import annotations

import ast
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Any, Optional

EXPORT_SCHEMA = "grimoire://character/v1"
DEFAULT_SCHEMA_ID = "dnd-5e-2024"
API_BASE = "https://v1.dicecloud.com"

STAT_NAMES = (
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
)

SKILL_CANON = {
    "acrobatics": "Acrobatics",
    "animalhandling": "Animal Handling",
    "animal handling": "Animal Handling",
    "arcana": "Arcana",
    "athletics": "Athletics",
    "deception": "Deception",
    "history": "History",
    "insight": "Insight",
    "intimidation": "Intimidation",
    "investigation": "Investigation",
    "medicine": "Medicine",
    "nature": "Nature",
    "perception": "Perception",
    "performance": "Performance",
    "persuasion": "Persuasion",
    "religion": "Religion",
    "sleightofhand": "Sleight of Hand",
    "sleight of hand": "Sleight of Hand",
    "stealth": "Stealth",
    "survival": "Survival",
}

SAVE_FIELDS = {
    "strengthsave": "strength_save_prof",
    "strength save": "strength_save_prof",
    "dexteritysave": "dexterity_save_prof",
    "dexterity save": "dexterity_save_prof",
    "constitutionsave": "constitution_save_prof",
    "constitution save": "constitution_save_prof",
    "intelligencesave": "intelligence_save_prof",
    "intelligence save": "intelligence_save_prof",
    "wisdomsave": "wisdom_save_prof",
    "wisdom save": "wisdom_save_prof",
    "charismasave": "charisma_save_prof",
    "charisma save": "charisma_save_prof",
}

CHAR_ID_RE = re.compile(
    r"(?:https?://)?v1\.dicecloud\.com/character/([\w]+)", re.IGNORECASE
)


# --- fetch -----------------------------------------------------------------


def parse_character_id(value: str) -> str:
    value = value.strip()
    m = CHAR_ID_RE.search(value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[\w]+", value):
        return value
    raise ValueError(f"Not a DiceCloud v1 character id or URL: {value!r}")


def fetch_via_api_key(char_id: str, api_key: str) -> dict:
    url = f"{API_BASE}/character/{urllib.parse.quote(char_id)}/json?key={urllib.parse.quote(api_key)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "grimoire-dicecloud-v1-import/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ValueError(f"DiceCloud API returned {exc.code} for {char_id}") from exc


class _SafeEval(ast.NodeVisitor):
    """Tiny arithmetic evaluator for DiceCloud effect calculations."""

    ALLOWED_FUNCS = {
        "floor": math.floor,
        "ceil": math.ceil,
        "round": round,
        "min": min,
        "max": max,
        "abs": abs,
    }

    def __init__(self, names: dict[str, Any]):
        self.names = {k.lower(): v for k, v in names.items()}

    def eval(self, expr: str) -> Any:
        expr = expr.strip()
        if not expr:
            raise ValueError("empty expression")
        # DiceCloud sometimes wraps vars in braces
        expr = expr.replace("{", "").replace("}", "")
        tree = ast.parse(expr, mode="eval")
        return self.visit(tree.body)

    def visit_Expression(self, node: ast.Expression) -> Any:
        return self.visit(node.body)

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left, right = self.visit(node.left), self.visit(node.right)
        op = node.op
        if isinstance(op, ast.Add):
            return left + right
        if isinstance(op, ast.Sub):
            return left - right
        if isinstance(op, ast.Mult):
            return left * right
        if isinstance(op, ast.Div):
            return left / right
        if isinstance(op, ast.FloorDiv):
            return left // right
        if isinstance(op, ast.Mod):
            return left % right
        if isinstance(op, ast.Pow):
            return left**right
        raise ValueError(f"unsupported operator {type(op).__name__}")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        val = self.visit(node.operand)
        if isinstance(node.op, ast.UAdd):
            return +val
        if isinstance(node.op, ast.USub):
            return -val
        raise ValueError("unsupported unary op")

    def visit_Call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name):
            raise ValueError("only simple function calls allowed")
        fn = self.ALLOWED_FUNCS.get(node.func.id.lower())
        if not fn:
            raise ValueError(f"unknown function {node.func.id}")
        args = [self.visit(a) for a in node.args]
        return fn(*args)

    def visit_Name(self, node: ast.Name) -> Any:
        key = node.id.lower()
        if key in self.names:
            return self.names[key]
        raise KeyError(node.id)

    def visit_Constant(self, node: ast.Constant) -> Any:
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("non-numeric constant")

    # py<3.8
    def visit_Num(self, node: ast.Num) -> Any:  # type: ignore[attr-defined]
        return node.n

    def generic_visit(self, node: ast.AST) -> Any:
        raise ValueError(f"unsupported syntax {type(node).__name__}")


def _active(doc: dict) -> bool:
    return bool(doc.get("enabled", True)) and not doc.get("removed", False)


def class_levels(data: dict) -> dict[str, int]:
    levels: dict[str, int] = defaultdict(int)
    for klass in data.get("classes") or []:
        if klass.get("removed"):
            continue
        name = (klass.get("name") or "Class").strip()
        levels[name] += int(klass.get("level") or 0)
    return dict(levels)


def calculate_stat(data: dict, stat: str, *, base: float = 0, names: Optional[dict] = None) -> float:
    """Resolve a DiceCloud v1 stat from its effect stack."""
    names = dict(names or {})
    add = 0.0
    mult = 1.0
    min_v: Optional[float] = None
    max_v: Optional[float] = None
    evaluator = _SafeEval(names)

    for effect in data.get("effects") or []:
        if not _active(effect) or effect.get("stat") != stat:
            continue
        op = effect.get("operation") or "base"
        if op not in ("base", "add", "mul", "min", "max"):
            continue
        if effect.get("value") is not None:
            value = float(effect["value"])
        else:
            calc = (effect.get("calculation") or "").strip()
            if not calc:
                continue
            try:
                value = float(evaluator.eval(calc))
            except (ValueError, KeyError, SyntaxError, TypeError):
                continue
        if op == "base" and value > base:
            base = value
        elif op == "add":
            add += value
        elif op == "mul":
            mult *= value
        elif op == "min":
            min_v = value if min_v is None else min(min_v, value)
        elif op == "max":
            max_v = value if max_v is None else max(max_v, value)

    out = (base + add) * mult
    if min_v is not None:
        out = max(out, min_v)
    if max_v is not None:
        out = min(out, max_v)
    return out


def ability_scores(data: dict, levels: dict[str, int]) -> dict[str, int]:
    names: dict[str, Any] = {"level": sum(levels.values())}
    for klass, lvl in levels.items():
        clean = re.sub(r"[.$]", "_", klass)
        names[f"{clean}Level"] = lvl
        names[f"{clean.lower()}level"] = lvl
    # Seed class-level aliases like PaladinLevel
    for klass, lvl in levels.items():
        names[f"{klass}Level"] = lvl

    scores: dict[str, int] = {}
    for stat in STAT_NAMES:
        scores[stat] = int(calculate_stat(data, stat, names=names))
        names[stat] = scores[stat]
        names[f"{stat}Mod"] = scores[stat] // 2 - 5
        names[f"{stat}mod"] = names[f"{stat}Mod"]
    return scores


def eval_attack_bits(data: dict, atk: dict, names: dict[str, Any]) -> tuple[Optional[str], Optional[str], str]:
    evaluator = _SafeEval(names)

    def sub_braces(text: str) -> str:
        def repl(m: re.Match) -> str:
            try:
                return str(int(evaluator.eval(m.group(1))))
            except Exception:
                try:
                    val = evaluator.eval(m.group(1))
                    return str(val)
                except Exception:
                    return m.group(0)

        return re.sub(r"\{([^{}]+)\}", repl, text)

    bonus_raw = (atk.get("attackBonus") or "").replace("{", "").replace("}", "").strip()
    bonus: Optional[str] = None
    if bonus_raw:
        try:
            bonus = str(int(evaluator.eval(bonus_raw)))
        except Exception:
            bonus = bonus_raw

    damage_raw = atk.get("damage") or ""
    damage = sub_braces(damage_raw).replace("{", "").replace("}", "")
    dtype = (atk.get("damageType") or "").strip()
    if damage:
        damage = re.sub(r"\+\s*-", "- ", damage)
        damage = re.sub(r"\s+", " ", damage).strip()
    if damage and dtype:
        damage = f"{damage} {dtype}"
    elif not damage:
        damage = dtype or None

    details = atk.get("details") or ""
    if details:
        details = sub_braces(details)
    return bonus, damage, details


# --- map to Grimoire -------------------------------------------------------


def inline(name: str, **props: Any) -> dict:
    row: dict[str, Any] = {"_inline": True, "name": name}
    per = props.pop("_per", None)
    row.update({k: v for k, v in props.items() if v is not None})
    if per:
        row["_per"] = per
    return row


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "entry"


def embed_entry(
    entries: dict[str, Any],
    *,
    content_type: str,
    name: str,
    data: Optional[dict] = None,
    source: str = "dicecloud-v1",
) -> dict:
    """Register a catalog stub and return a content_ref pointing at it."""
    entry_id = f"dc-{content_type}-{_slug(name)}"
    payload = {"name": name}
    if data:
        payload.update({k: v for k, v in data.items() if v is not None})
    entries[entry_id] = {
        "content_type": content_type,
        "source": source,
        "name": name,
        "data": payload,
    }
    return {"_ref": entry_id, "_source": source}


def guess_background(char: dict) -> tuple[str, str]:
    """Return (background_name, remaining_backstory)."""
    raw = (char.get("backstory") or "").strip()
    if not raw:
        return "", ""
    first, _, rest = raw.partition("\n")
    first = first.strip()
    # Common DC pattern: background name on line 1, feature blurb after
    if first and len(first) <= 40 and not first.startswith("#") and "**" not in first:
        return first, rest.lstrip("\n")
    return "", raw


def feats_from_effects(data: dict) -> list[str]:
    found: list[str] = []
    for effect in data.get("effects") or []:
        if not _active(effect):
            continue
        name = (effect.get("name") or "").strip()
        m = re.match(r"^(?:Free\s+)?Feat:\s*(.+)$", name, re.I)
        if m:
            found.append(m.group(1).strip())
    return list(dict.fromkeys(found))


def is_magic_item(name: str) -> bool:
    n = name.lower()
    if re.search(r"\+\s*\d", n):
        return True
    return any(
        token in n
        for token in (
            "potion of",
            "scroll of",
            "wand of",
            "ring of",
            "cloak of",
            "boots of",
            "amulet",
            "figurine",
            "bag of holding",
            "pact",
        )
    )


def convert(data: dict, *, schema_id: str = DEFAULT_SCHEMA_ID, schema_doc: Optional[dict] = None) -> dict:
    chars = data.get("characters") or []
    if not chars:
        raise ValueError("DiceCloud dump has no characters[]")
    char = chars[0]
    levels = class_levels(data)
    total_level = sum(levels.values()) or 1
    scores = ability_scores(data, levels)

    names: dict[str, Any] = {"level": total_level, "Level": total_level}
    for klass, lvl in levels.items():
        names[f"{klass}Level"] = lvl
    for stat, score in scores.items():
        names[stat] = score
        names[f"{stat}Mod"] = score // 2 - 5
    names["proficiencyBonus"] = int(
        calculate_stat(data, "proficiencyBonus", names=names)
        or (2 + (total_level - 1) // 4)
    )
    names["dexterityArmor"] = int(calculate_stat(data, "dexterityArmor", base=names["dexterityMod"], names=names))

    hp_max = int(calculate_stat(data, "hitPoints", names=names))
    ac = int(calculate_stat(data, "armor", names=names))
    speed = int(calculate_stat(data, "speed", base=30, names=names))

    # Proficiencies
    skill_profs: list[str] = []
    save_flags: dict[str, bool] = {}
    weapons: list[str] = []
    armors: list[str] = []
    tools: list[str] = []
    languages: list[str] = []
    for prof in data.get("proficiencies") or []:
        if not _active(prof):
            continue
        pname = (prof.get("name") or "").strip()
        if not pname:
            continue
        key = re.sub(r"\s+", " ", pname).lower()
        key_compact = key.replace(" ", "")
        if key in SAVE_FIELDS or key_compact in SAVE_FIELDS:
            save_flags[SAVE_FIELDS.get(key) or SAVE_FIELDS[key_compact]] = True
            continue
        skill = SKILL_CANON.get(key) or SKILL_CANON.get(key_compact)
        if skill:
            skill_profs.append(skill)
            continue
        ptype = (prof.get("type") or "").lower()
        if "weapon" in key or ptype == "weapon":
            weapons.append(pname)
        elif "armor" in key or "shield" in key.lower() or ptype == "armor":
            armors.append(pname)
        elif "tool" in key or ptype == "tool":
            tools.append(pname)
        elif ptype == "language" or key in ("common", "elven", "elvish", "sylvan", "draconic"):
            languages.append(pname.replace("Elven", "Elvish") if pname == "Elven" else pname)
        else:
            # fall through: language-like words
            if any(x in key for x in ("common", "elv", "dwarv", "orc", "draconic", "sylvan", "infernal", "celestial")):
                languages.append(pname)

    primary_class = max(levels.items(), key=lambda kv: kv[1])[0] if levels else ""
    subclass = ""
    for feat in data.get("features") or []:
        if not _active(feat):
            continue
        fname = feat.get("name") or ""
        m = re.match(r"\(Oath of ([^)]+)\)\s*$", fname.strip())
        if m:
            subclass = f"Oath of {m.group(1).strip()}"
            break
        m = re.search(r"subclass[:\s]+(.+)", fname, re.I)
        if m and not subclass:
            subclass = m.group(1).strip()

    background_name, backstory_body = guess_background(char)
    entries: dict[str, Any] = {}

    features = []
    feats: list[dict] = []
    feat_names: set[str] = set()
    species_traits = []
    for feat in data.get("features") or []:
        if not _active(feat):
            continue
        fname = (feat.get("name") or "").strip()
        if not fname or fname == "Base Ability Scores":
            continue
        desc = (feat.get("description") or "").strip()
        uses = feat.get("uses")
        if uses:
            desc = (desc + f"\n\nUses: {uses}").strip()
        entry = inline(fname, description=desc or None, level=total_level, **{"class": primary_class or None})
        low = fname.lower()
        if "free feat" in low or re.match(r"^(?:free\s+)?feat:", low):
            clean = re.sub(r"^(?:Free\s+)?Feat:\s*", "", fname, flags=re.I).strip()
            feats.append(inline(clean, description=desc or None))
            feat_names.add(clean.lower())
        elif "species" in low or "sub-species" in low or "lineage" in low:
            species_traits.append(inline(fname, description=desc or None, species=char.get("race") or None))
        else:
            features.append(entry)

    # Feats that only exist as effect labels (e.g. Telepathic) never appear under features
    for feat_name in feats_from_effects(data):
        if feat_name.lower() not in feat_names:
            feats.append(inline(feat_name))
            feat_names.add(feat_name.lower())

    attacks = []
    for atk in data.get("attacks") or []:
        if not _active(atk):
            continue
        bonus, damage, details = eval_attack_bits(data, atk, names)
        attacks.append(
            {
                "name": (atk.get("name") or "Attack").strip(),
                "bonus": bonus or "",
                "damage": damage or "",
                "notes": details or "",
            }
        )

    spells = []
    for spell in data.get("spells") or []:
        if spell.get("removed"):
            continue
        sname = (spell.get("name") or "").strip()
        if not sname:
            continue
        prepared = spell.get("prepared") in ("prepared", "always")
        spells.append(inline(sname, _per={"prepared": prepared}))

    equipment = []
    magic_items = []
    gp = sp = cp = ep = pp = 0
    coin_re = re.compile(
        r"^((plat(inum)?|gold|electrum|silver|copper)( coins?| pieces?)?|(pp|gp|ep|sp|cp))$",
        re.I,
    )
    for item in data.get("items") or []:
        if item.get("removed"):
            continue
        iname = (item.get("name") or "").strip()
        qty = int(item.get("quantity") or 0)
        if not iname:
            continue
        if coin_re.fullmatch(iname):
            key = iname.lower()
            if key.startswith("pp") or key.startswith("plat"):
                pp += qty
            elif key.startswith("gp") or key.startswith("gold"):
                gp += qty
            elif key.startswith("ep") or key.startswith("electrum"):
                ep += qty
            elif key.startswith("sp") or key.startswith("silver"):
                sp += qty
            elif key.startswith("cp") or key.startswith("copper"):
                cp += qty
            continue
        desc = (item.get("description") or "").strip() or None
        if is_magic_item(iname):
            magic_items.append(
                inline(iname, description=desc, _per={"attuned": False})
            )
        else:
            equipment.append(
                inline(iname, description=desc, _per={"qty": max(qty, 1), "equipped": True})
            )

    class_dice = {
        "barbarian": 12,
        "fighter": 10,
        "paladin": 10,
        "ranger": 10,
        "artificer": 8,
        "bard": 8,
        "cleric": 8,
        "druid": 8,
        "monk": 8,
        "rogue": 8,
        "warlock": 8,
        "wizard": 6,
        "sorcerer": 6,
    }
    hit_die = class_dice.get(primary_class.lower(), 8)

    armor_text = " ".join(armors).lower()
    has_shield_item = any(
        (i.get("name") or "").lower() == "shield"
        for i in (data.get("items") or [])
        if not i.get("removed")
    )

    # Persona / notes from DiceCloud note tabs
    dc_notes = []
    for note in data.get("notes") or []:
        if note.get("removed"):
            continue
        title = (note.get("name") or "").strip() or "Note"
        body = (note.get("description") or "").strip()
        if body:
            dc_notes.append(f"### {title}\n{body}")

    picture = (char.get("picture") or "").strip()
    race = (char.get("race") or "").strip()
    gender = (char.get("gender") or "").strip()

    backstory_parts = [
        backstory_body.strip() if backstory_body else "",
        (char.get("personality") or "").strip() and f"Personality:\n{char.get('personality')}",
        (char.get("ideals") or "").strip() and f"Ideals:\n{char.get('ideals')}",
        (char.get("bonds") or "").strip() and f"Bonds:\n{char.get('bonds')}",
        (char.get("flaws") or "").strip() and f"Flaws:\n{char.get('flaws')}",
    ]
    if gender:
        backstory_parts.insert(0, f"Gender: {gender}")

    sheet: dict[str, Any] = {
        "hero_name": (char.get("name") or "").strip(),
        "level": total_level,
        "subclass": subclass,
        "alignment": (char.get("alignment") or "").strip() or None,
        "strength": scores["strength"],
        "dexterity": scores["dexterity"],
        "constitution": scores["constitution"],
        "intelligence": scores["intelligence"],
        "wisdom": scores["wisdom"],
        "charisma": scores["charisma"],
        "hp_max": hp_max,
        "hp_current": hp_max,
        "hp_temp": 0,
        "hit_dice": f"{total_level}d{hit_die}",
        "speed": speed,
        "size": "Medium",
        "skill_profs": skill_profs,
        "shield": "shield" in armor_text or has_shield_item,
        "armor_light": "light" in armor_text,
        "armor_medium": "medium" in armor_text,
        "armor_heavy": "heavy" in armor_text,
        "armor_shields": "shield" in armor_text or has_shield_item,
        "weapon_training": "; ".join(weapons),
        "tool_training": "; ".join(tools),
        "languages": ", ".join(dict.fromkeys(languages)),
        "appearance": (char.get("description") or "").strip(),
        "backstory": "\n\n".join(p for p in backstory_parts if p),
        "gp": gp,
        "sp": sp,
        "cp": cp,
        "ep": ep,
        "pp": pp,
        "attacks": attacks,
        "features": features,
        "feats": feats,
        "species_traits": species_traits,
        "equipment": equipment,
        "magic_items": magic_items,
        "spells": spells,
        "notes": "\n\n".join(
            p
            for p in [
                f"Imported from DiceCloud v1 (`{char.get('_id')}`).",
                f"Portrait URL: {picture}" if picture else "",
                f"Class levels: {', '.join(f'{n} {lv}' for n, lv in levels.items()) or '—'}.",
                f"Resolved AC from DiceCloud effects: {ac}.",
                *dc_notes,
            ]
            if p
        ),
        "_overrides": {"armor_class": ac},
    }

    if race:
        sheet["species"] = embed_entry(
            entries,
            content_type="species",
            name=race,
            data={"name": race, "size": "Medium", "speed": speed},
        )
    if primary_class:
        sheet["klass"] = embed_entry(
            entries,
            content_type="class",
            name=primary_class,
            data={
                "name": primary_class,
                "hit_die": hit_die,
                "saving_throws": ", ".join(
                    s.replace("_save_prof", "").replace("_", " ").title()
                    for s, on in save_flags.items()
                    if on
                )
                or None,
            },
        )
    if background_name:
        sheet["background"] = embed_entry(
            entries,
            content_type="background",
            name=background_name,
            data={"name": background_name, "description": backstory_body[:2000] or None},
        )

    for field, enabled in save_flags.items():
        sheet[field] = enabled

    # Spellcasting
    slots = {}
    for lvl in range(1, 10):
        n = int(calculate_stat(data, f"level{lvl}SpellSlots", names=names))
        if n:
            slots[lvl] = n
    if slots or spells:
        sheet["is_caster"] = True
        sheet["spell_ability"] = "charisma" if "paladin" in primary_class.lower() else "intelligence"
        for sl in data.get("spellLists") or []:
            ab = (sl.get("attackBonus") or "").lower()
            for ability in ("charisma", "wisdom", "intelligence"):
                if ability in ab:
                    sheet["spell_ability"] = ability
        sheet["caster_level"] = total_level
        for lvl, n in slots.items():
            sheet[f"slots_{lvl}_total"] = n
            sheet[f"slots_{lvl}_used"] = 0

    sheet = {k: v for k, v in sheet.items() if v is not None and v != ""}

    payload = {
        "$schema": EXPORT_SCHEMA,
        "name": sheet.get("hero_name") or "Imported Character",
        "status": "active",
        "schema_id": schema_id,
        "data": sheet,
        "entries": entries,
    }
    if schema_doc:
        payload["schema"] = schema_doc
    # Surface portrait URL for a follow-up upload step (Grimoire stores files, not remote URLs)
    if picture:
        payload["portrait_url"] = picture
    return payload




def import_from_url(url: str, *, api_key: str, schema_id: str = DEFAULT_SCHEMA_ID) -> dict:
    """Fetch a DiceCloud v1 character URL and return a Grimoire import payload."""
    char_id = parse_character_id(url)
    if not api_key or not api_key.strip():
        raise ValueError(
            "DiceCloud v1 import needs an API key. Set DICECLOUD_API_KEY on the "
            "server, or pass api_key in the import request."
        )
    data = fetch_via_api_key(char_id, api_key.strip())
    return convert(data, schema_id=schema_id)

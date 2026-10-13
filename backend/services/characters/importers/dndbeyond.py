"""D&D Beyond → Grimoire character payload.

Registered as import source id ``dndbeyond`` for D&D 5e sheets that declare it
under ``import_sources``. Fetches the public character JSON endpoint
(``/character/{id}/json``). Private / unshared sheets return 401/403.
"""

from __future__ import annotations

import html
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from typing import Any, Optional

EXPORT_SCHEMA = "grimoire://character/v1"
DEFAULT_SCHEMA_ID = "dnd-5e-2024"
API_HOST = "https://www.dndbeyond.com"
SOURCE_ID = "dndbeyond"

STAT_BY_ID = {
    1: "strength",
    2: "dexterity",
    3: "constitution",
    4: "intelligence",
    5: "wisdom",
    6: "charisma",
}

STAT_SCORE_SUBTYPE = {
    "strength-score": "strength",
    "dexterity-score": "dexterity",
    "constitution-score": "constitution",
    "intelligence-score": "intelligence",
    "wisdom-score": "wisdom",
    "charisma-score": "charisma",
}

SAVE_SUBTYPE = {
    "strength-saving-throws": "strength_save_prof",
    "dexterity-saving-throws": "dexterity_save_prof",
    "constitution-saving-throws": "constitution_save_prof",
    "intelligence-saving-throws": "intelligence_save_prof",
    "wisdom-saving-throws": "wisdom_save_prof",
    "charisma-saving-throws": "charisma_save_prof",
}

SKILL_CANON = {
    "acrobatics": "Acrobatics",
    "animal-handling": "Animal Handling",
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
    "sleight-of-hand": "Sleight of Hand",
    "stealth": "Stealth",
    "survival": "Survival",
}

ALIGNMENT_BY_ID = {
    1: "Lawful Good",
    2: "Neutral Good",
    3: "Chaotic Good",
    4: "Lawful Neutral",
    5: "Neutral",
    6: "Chaotic Neutral",
    7: "Lawful Evil",
    8: "Neutral Evil",
    9: "Chaotic Evil",
}

# Skip builder scaffolding; keep real class features.
_SKIP_CLASS_FEATURES = {
    "hit points",
    "proficiencies",
    "equipment",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]+\n")
_DDB_HOSTS = frozenset({"dndbeyond.com", "www.dndbeyond.com"})


# --- fetch -----------------------------------------------------------------


def parse_character_id(value: str) -> str:
    """Extract a D&D Beyond character id from a bare id or canonical URL.

    The host must be ``dndbeyond.com`` (optional ``www.``) so a substring like
    ``evil.example/dndbeyond.com/...`` cannot sneak through.
    """
    value = value.strip()
    if re.fullmatch(r"\d+", value):
        return value
    parsed = urllib.parse.urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.hostname or "").lower()
    if host not in _DDB_HOSTS:
        raise ValueError(f"Not a D&D Beyond character id or URL: {value!r}")
    parts = [p for p in parsed.path.split("/") if p]
    if (
        len(parts) >= 2
        and parts[0].lower() in ("character", "characters")
        and re.fullmatch(r"\d+", parts[1])
    ):
        return parts[1]
    raise ValueError(f"Not a D&D Beyond character id or URL: {value!r}")


def fetch_character(char_id: str) -> dict:
    """Fetch public character JSON. Raises ValueError on failure."""
    url = f"{API_HOST}/character/{urllib.parse.quote(char_id)}/json"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "grimoire-dndbeyond-import/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ValueError(
                f"D&D Beyond character {char_id} is private or not shared publicly"
            ) from exc
        if exc.code == 404:
            raise ValueError(f"D&D Beyond character {char_id} was not found") from exc
        raise ValueError(f"D&D Beyond returned {exc.code} for character {char_id}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Could not reach D&D Beyond: {exc.reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("D&D Beyond returned non-JSON (character may be private)") from exc
    if not isinstance(data, dict) or not data.get("id"):
        raise ValueError("D&D Beyond response was not a character payload")
    return data


# --- helpers ---------------------------------------------------------------


def strip_html(value: Optional[str]) -> str:
    if not value:
        return ""
    text = html.unescape(_TAG_RE.sub("", value))
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = _WS_RE.sub("\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def ability_mod(score: int) -> int:
    return math.floor((score - 10) / 2)


def iter_modifiers(data: dict) -> Iterator[dict]:
    mods = data.get("modifiers") or {}
    if not isinstance(mods, dict):
        return
    for items in mods.values():
        for mod in items or []:
            if isinstance(mod, dict):
                yield mod


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
) -> dict:
    entry_id = f"ddb-{content_type}-{_slug(name)}"
    payload = {"name": name}
    if data:
        payload.update({k: v for k, v in data.items() if v is not None})
    entries[entry_id] = {
        "content_type": content_type,
        "source": SOURCE_ID,
        "name": name,
        "data": payload,
    }
    return {"_ref": entry_id, "_source": SOURCE_ID}


def ability_scores(data: dict) -> dict[str, int]:
    scores = {name: 10 for name in STAT_BY_ID.values()}
    for row in data.get("stats") or []:
        name = STAT_BY_ID.get(row.get("id"))
        if name and row.get("value") is not None:
            scores[name] = int(row["value"])
    for row in data.get("bonusStats") or []:
        name = STAT_BY_ID.get(row.get("id"))
        if name and row.get("value") is not None:
            scores[name] += int(row["value"])
    for mod in iter_modifiers(data):
        if (mod.get("type") or "").lower() != "bonus":
            continue
        stat = STAT_SCORE_SUBTYPE.get((mod.get("subType") or "").lower())
        if stat and mod.get("value") is not None:
            scores[stat] += int(mod["value"])
    for row in data.get("overrideStats") or []:
        name = STAT_BY_ID.get(row.get("id"))
        if name and row.get("value") is not None:
            scores[name] = int(row["value"])
    return scores


def total_level(data: dict) -> int:
    return sum(int(c.get("level") or 0) for c in data.get("classes") or [])


def class_levels(data: dict) -> list[tuple[str, int, Optional[str], int]]:
    """Return (name, level, subclass, hit_die) rows."""
    out = []
    for klass in data.get("classes") or []:
        defn = klass.get("definition") or {}
        sub = klass.get("subclassDefinition") or {}
        name = (defn.get("name") or "").strip()
        if not name:
            continue
        out.append(
            (
                name,
                int(klass.get("level") or 0),
                (sub.get("name") or "").strip() or None,
                int(defn.get("hitDice") or 8),
            )
        )
    return out


def portrait_url(data: dict) -> str:
    url = (data.get("avatarUrl") or "").strip()
    if url:
        # Prefer a larger render when Beyond serves a thumbnail path.
        return re.sub(
            r"/avatars/thumbnails/(\d+)/(\d+)/\d+/\d+/",
            r"/avatars/\1/\2/",
            url,
        )
    return ""


def collect_proficiencies(data: dict) -> dict[str, Any]:
    skill_profs: list[str] = []
    skill_expertise: list[str] = []
    skill_half: list[str] = []
    save_flags: dict[str, bool] = {v: False for v in SAVE_SUBTYPE.values()}
    weapons: list[str] = []
    armors: list[str] = []
    tools: list[str] = []
    languages: list[str] = ["Common"]

    for mod in iter_modifiers(data):
        mtype = (mod.get("type") or "").lower()
        subtype = (mod.get("subType") or "").lower()
        friendly = (
            (mod.get("friendlySubtypeName") or mod.get("friendlyTypeName") or "")
            .strip()
        )

        if mtype == "language":
            lang = friendly or subtype.replace("-", " ").title()
            if lang and lang.lower() not in {x.lower() for x in languages}:
                languages.append(lang)
            continue

        if subtype in SAVE_SUBTYPE and mtype in ("proficiency", "expertise"):
            save_flags[SAVE_SUBTYPE[subtype]] = True
            continue

        skill = SKILL_CANON.get(subtype)
        if skill:
            if mtype == "expertise":
                if skill not in skill_expertise:
                    skill_expertise.append(skill)
                if skill not in skill_profs:
                    skill_profs.append(skill)
            elif mtype == "half-proficiency":
                if skill not in skill_half:
                    skill_half.append(skill)
            elif mtype == "proficiency":
                if skill not in skill_profs:
                    skill_profs.append(skill)
            continue

        if mtype != "proficiency":
            continue
        label = friendly or subtype.replace("-", " ").title()
        if not label:
            continue
        if "weapon" in subtype or subtype.endswith("-weapons") or "weapons" in subtype:
            weapons.append(label)
        elif "armor" in subtype or subtype == "shields":
            armors.append(label)
        elif "tool" in subtype or subtype.endswith("-kit") or "supplies" in subtype:
            tools.append(label)

    for custom in data.get("customProficiencies") or []:
        name = (custom.get("name") or "").strip()
        if name and name not in tools:
            tools.append(name)

    return {
        "skill_profs": skill_profs,
        "skill_expertise": skill_expertise,
        "skill_half_profs": skill_half,
        "save_flags": save_flags,
        "weapons": weapons,
        "armors": armors,
        "tools": tools,
        "languages": languages,
    }


def hit_points(data: dict, scores: dict[str, int], level: int) -> tuple[int, int, int]:
    """Return (hp_max, hp_current, hp_temp)."""
    if data.get("overrideHitPoints") is not None:
        hp_max = int(data["overrideHitPoints"])
    else:
        base = int(data.get("baseHitPoints") or 0)
        bonus = int(data.get("bonusHitPoints") or 0)
        con_bonus = ability_mod(scores["constitution"]) * max(level, 0)
        misc = 0
        for mod in iter_modifiers(data):
            if (mod.get("type") or "").lower() != "bonus":
                continue
            if (mod.get("subType") or "").lower() in (
                "hit-points",
                "hit-points-per-level",
            ):
                val = int(mod.get("value") or 0)
                if (mod.get("subType") or "").lower() == "hit-points-per-level":
                    misc += val * max(level, 0)
                else:
                    misc += val
        hp_max = base + bonus + con_bonus + misc
    removed = int(data.get("removedHitPoints") or 0)
    temp = int(data.get("temporaryHitPoints") or 0)
    return max(hp_max, 0), max(hp_max - removed, 0), max(temp, 0)


def background_name(data: dict) -> str:
    bg = data.get("background") or {}
    custom = bg.get("customBackground") or {}
    if isinstance(custom, dict) and (custom.get("name") or "").strip():
        return custom["name"].strip()
    defn = bg.get("definition") or {}
    return (defn.get("name") or "").strip()


def walk_speed(data: dict) -> int:
    race = data.get("race") or {}
    speeds = ((race.get("weightSpeeds") or {}).get("normal") or {})
    walk = int(speeds.get("walk") or 30)
    for mod in iter_modifiers(data):
        if (mod.get("type") or "").lower() != "set":
            continue
        subtype = (mod.get("subType") or "").lower()
        if subtype in ("innate-speed-walking", "unarmored-movement"):
            if mod.get("value") is not None:
                walk = int(mod["value"])
    return walk


# --- convert ---------------------------------------------------------------


def convert(data: dict, *, schema_id: str = DEFAULT_SCHEMA_ID, schema_doc: Optional[dict] = None) -> dict:
    """Map a D&D Beyond character JSON blob to a Grimoire import payload."""
    scores = ability_scores(data)
    level = total_level(data)
    levels = class_levels(data)
    primary_class = ""
    subclass = ""
    hit_die = 8
    if levels:
        primary_name, primary_lvl, primary_sub, hit_die = max(levels, key=lambda r: r[1])
        primary_class = primary_name
        subclass = primary_sub or ""
        # Prefer an explicit subclass from any class row.
        for _n, _lv, sub, _hd in levels:
            if sub:
                subclass = sub
                break

    profs = collect_proficiencies(data)
    hp_max, hp_current, hp_temp = hit_points(data, scores, level)
    speed = walk_speed(data)
    race = data.get("race") or {}
    race_name = (race.get("fullName") or race.get("baseName") or "").strip()
    size = (race.get("size") or "Medium").strip() or "Medium"
    picture = portrait_url(data)
    entries: dict[str, Any] = {}

    # Features + species traits
    features: list[dict] = []
    for klass in data.get("classes") or []:
        defn = klass.get("definition") or {}
        cname = (defn.get("name") or "").strip()
        clevel = int(klass.get("level") or 0)
        for feat in defn.get("classFeatures") or []:
            fname = (feat.get("name") or "").strip()
            if not fname or fname.lower() in _SKIP_CLASS_FEATURES:
                continue
            if feat.get("hideInSheet"):
                continue
            req = int(feat.get("requiredLevel") or 1)
            if req > clevel:
                continue
            # Skip third-party optional hooks that aren't real granted features.
            if ":" in fname and req == 1 and fname.lower().startswith(
                ("obojima", "the crooked moon", "grim hollow", "taldorei")
            ):
                continue
            desc = strip_html(feat.get("description") or feat.get("snippet") or "")
            features.append(
                inline(fname, description=desc or None, level=req, **{"class": cname or None})
            )
        sub = klass.get("subclassDefinition") or {}
        for feat in sub.get("classFeatures") or []:
            fname = (feat.get("name") or "").strip()
            if not fname or feat.get("hideInSheet"):
                continue
            req = int(feat.get("requiredLevel") or 1)
            if req > clevel:
                continue
            desc = strip_html(feat.get("description") or feat.get("snippet") or "")
            features.append(
                inline(fname, description=desc or None, level=req, **{"class": cname or None})
            )

    # Action-only features sometimes absent from classFeatures list
    seen_feature_names = {f["name"].lower() for f in features}

    def _feature_covered(name: str) -> bool:
        low = name.lower()
        if low in seen_feature_names:
            return True
        # "Lay on Hands Pool" is covered by class feature "Lay on Hands"
        return any(low.startswith(existing) or existing.startswith(low) for existing in seen_feature_names)

    for group in (data.get("actions") or {}).values() if isinstance(data.get("actions"), dict) else []:
        for action in group or []:
            aname = (action.get("name") or "").strip()
            if not aname or _feature_covered(aname):
                continue
            desc = strip_html(action.get("description") or action.get("snippet") or "")
            features.append(inline(aname, description=desc or None, **{"class": primary_class or None}))
            seen_feature_names.add(aname.lower())

    species_traits: list[dict] = []
    for trait in race.get("racialTraits") or []:
        defn = trait.get("definition") or {}
        tname = (defn.get("name") or "").strip()
        if not tname or tname.lower() in (
            "ability score increases",
            "languages",
            "size",
            "speed",
        ):
            continue
        if defn.get("hideInSheet"):
            continue
        desc = strip_html(defn.get("description") or defn.get("snippet") or "")
        species_traits.append(
            inline(tname, description=desc or None, species=race_name or None)
        )

    feats: list[dict] = []
    for feat in data.get("feats") or []:
        defn = feat.get("definition") or {}
        fname = (defn.get("name") or "").strip()
        if not fname:
            continue
        desc = strip_html(defn.get("description") or defn.get("snippet") or "")
        feats.append(inline(fname, description=desc or None))

    # Equipment + attacks from inventory
    equipment: list[dict] = []
    magic_items: list[dict] = []
    attacks: list[dict] = []
    armor_flags = {
        "armor_light": False,
        "armor_medium": False,
        "armor_heavy": False,
        "armor_shields": "Shields" in profs["armors"] or any(
            "shield" in a.lower() for a in profs["armors"]
        ),
        "shield": False,
    }

    for item in data.get("inventory") or []:
        defn = item.get("definition") or {}
        iname = (defn.get("name") or "").strip()
        if not iname:
            continue
        qty = int(item.get("quantity") or 1)
        equipped = bool(item.get("equipped"))
        desc = strip_html(defn.get("description") or "")
        filter_type = (defn.get("filterType") or "").strip()
        rarity = (defn.get("rarity") or "").strip().lower()
        is_magic = bool(defn.get("magic")) or (
            rarity and rarity not in ("", "common", "none", "varies")
        )

        if filter_type == "Armor" or (defn.get("type") or "").lower().endswith("armor"):
            t = (defn.get("type") or "").lower()
            if "light" in t:
                armor_flags["armor_light"] = True
            elif "medium" in t:
                armor_flags["armor_medium"] = True
            elif "heavy" in t:
                armor_flags["armor_heavy"] = True
            if "shield" in t or iname.lower() == "shield":
                armor_flags["shield"] = equipped or armor_flags["shield"]
                armor_flags["armor_shields"] = True

        if filter_type == "Weapon":
            dmg = defn.get("damage") or {}
            dice = (dmg.get("diceString") or "").strip()
            dtype = (defn.get("damageType") or "").strip()
            damage = f"{dice} {dtype}".strip() if dice or dtype else ""
            props = ", ".join(
                p.get("name") for p in (defn.get("properties") or []) if p.get("name")
            )
            notes_bits = [props] if props else []
            rng = defn.get("range")
            long_rng = defn.get("longRange")
            if rng and long_rng and long_rng != rng:
                notes_bits.append(f"range {rng}/{long_rng}")
            elif rng and int(rng or 0) > 5:
                notes_bits.append(f"range {rng}")
            attacks.append(
                {
                    "name": iname,
                    "bonus": "",
                    "damage": damage,
                    "notes": "; ".join(notes_bits),
                }
            )

        row = inline(
            iname,
            description=desc or None,
            _per={"qty": max(qty, 1), "equipped": equipped},
        )
        if is_magic:
            magic_items.append(
                inline(iname, description=desc or None, _per={"attuned": bool(item.get("isAttuned"))})
            )
        else:
            equipment.append(row)

    for custom in data.get("customItems") or []:
        cname = (custom.get("name") or "").strip()
        if not cname:
            continue
        equipment.append(
            inline(
                cname,
                description=strip_html(custom.get("description") or "") or None,
                _per={"qty": int(custom.get("quantity") or 1), "equipped": False},
            )
        )

    # Spells
    spells: list[dict] = []
    seen_spells: set[str] = set()
    for group in data.get("classSpells") or []:
        for spell in group.get("spells") or []:
            defn = spell.get("definition") or {}
            sname = (defn.get("name") or "").strip()
            if not sname or sname.lower() in seen_spells:
                continue
            seen_spells.add(sname.lower())
            spells.append(
                inline(sname, _per={"prepared": bool(spell.get("prepared"))})
            )
    # Innate / racial spells sometimes only in modifiers or actions — skip deep parse.

    notes = data.get("notes") or {}
    if not isinstance(notes, dict):
        notes = {}
    backstory_parts = []
    if notes.get("backstory"):
        backstory_parts.append(strip_html(notes["backstory"]))
    traits_blob = data.get("traits") if isinstance(data.get("traits"), dict) else {}
    for key, label in (
        ("personalityTraits", "Personality"),
        ("ideals", "Ideals"),
        ("bonds", "Bonds"),
        ("flaws", "Flaws"),
    ):
        val = strip_html((traits_blob or {}).get(key) or "")
        if val:
            backstory_parts.append(f"{label}:\n{val}")

    appearance_bits = []
    for key, label in (
        ("gender", "Gender"),
        ("age", "Age"),
        ("height", "Height"),
        ("weight", "Weight"),
        ("eyes", "Eyes"),
        ("hair", "Hair"),
        ("skin", "Skin"),
    ):
        val = data.get(key)
        if val is not None and str(val).strip():
            appearance_bits.append(f"{label}: {str(val).strip()}")

    currencies = data.get("currencies") or {}
    bg_name = background_name(data)
    alignment = ALIGNMENT_BY_ID.get(data.get("alignmentId") or 0)

    sheet: dict[str, Any] = {
        "hero_name": (data.get("name") or "").strip(),
        "level": level,
        "subclass": subclass,
        "alignment": alignment,
        "strength": scores["strength"],
        "dexterity": scores["dexterity"],
        "constitution": scores["constitution"],
        "intelligence": scores["intelligence"],
        "wisdom": scores["wisdom"],
        "charisma": scores["charisma"],
        "hp_max": hp_max,
        "hp_current": hp_current,
        "hp_temp": hp_temp,
        "hit_dice": f"{level}d{hit_die}" if level else None,
        "speed": speed,
        "size": size,
        "skill_profs": profs["skill_profs"],
        "skill_expertise": profs["skill_expertise"],
        "skill_half_profs": profs["skill_half_profs"],
        **armor_flags,
        "weapon_training": "; ".join(dict.fromkeys(profs["weapons"])),
        "tool_training": "; ".join(dict.fromkeys(profs["tools"])),
        "languages": ", ".join(dict.fromkeys(profs["languages"])),
        "appearance": "; ".join(appearance_bits),
        "backstory": "\n\n".join(p for p in backstory_parts if p),
        "gp": int(currencies.get("gp") or 0),
        "sp": int(currencies.get("sp") or 0),
        "cp": int(currencies.get("cp") or 0),
        "ep": int(currencies.get("ep") or 0),
        "pp": int(currencies.get("pp") or 0),
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
                f"Imported from D&D Beyond (`{data.get('id')}`).",
                f"Class levels: {', '.join(f'{n} {lv}' for n, lv, _s, _h in levels) or '—'}.",
                strip_html(notes.get("organizations") or "")
                and f"Organizations:\n{strip_html(notes.get('organizations'))}",
                strip_html(notes.get("allies") or "")
                and f"Allies:\n{strip_html(notes.get('allies'))}",
                strip_html(notes.get("enemies") or "")
                and f"Enemies:\n{strip_html(notes.get('enemies'))}",
                strip_html(notes.get("personalPossessions") or "")
                and f"Personal possessions:\n{strip_html(notes.get('personalPossessions'))}",
                strip_html(notes.get("otherNotes") or "")
                and f"Other notes:\n{strip_html(notes.get('otherNotes'))}",
            ]
            if p
        ),
    }

    for field, enabled in profs["save_flags"].items():
        sheet[field] = enabled

    if race_name:
        sheet["species"] = embed_entry(
            entries,
            content_type="species",
            name=race_name,
            data={"name": race_name, "size": size, "speed": speed},
        )
    if primary_class:
        saves = ", ".join(
            s.replace("_save_prof", "").replace("_", " ").title()
            for s, on in profs["save_flags"].items()
            if on
        )
        sheet["klass"] = embed_entry(
            entries,
            content_type="class",
            name=primary_class,
            data={"name": primary_class, "hit_die": hit_die, "saving_throws": saves or None},
        )
    if bg_name:
        sheet["background"] = embed_entry(
            entries,
            content_type="background",
            name=bg_name,
            data={"name": bg_name},
        )

    # Spellcasting flag for half/full casters with spells or known casting ability
    spell_ability_id = None
    for klass in data.get("classes") or []:
        defn = klass.get("definition") or {}
        if defn.get("spellCastingAbilityId"):
            spell_ability_id = defn["spellCastingAbilityId"]
            break
        sub = klass.get("subclassDefinition") or {}
        if sub.get("spellCastingAbilityId"):
            spell_ability_id = sub["spellCastingAbilityId"]
            break
    if spell_ability_id or spells:
        sheet["is_caster"] = True
        sheet["spell_ability"] = STAT_BY_ID.get(spell_ability_id, "charisma")
        sheet["caster_level"] = level

    sheet = {k: v for k, v in sheet.items() if v is not None and v != "" and v != []}

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
    if picture:
        payload["portrait_url"] = picture
    return payload


def import_from_url(url: str, *, schema_id: str = DEFAULT_SCHEMA_ID) -> dict:
    """Fetch a public D&D Beyond character URL and return a Grimoire import payload."""
    char_id = parse_character_id(url)
    data = fetch_character(char_id)
    return convert(data, schema_id=schema_id)

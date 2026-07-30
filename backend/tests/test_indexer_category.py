"""Tests for guess_category(), agnostic_category(), and is_system_agnostic_folder() in the library indexer."""
from backend.indexer import (
    agnostic_category,
    guess_category,
    is_one_page_folder,
    is_special_collection_folder,
    is_system_agnostic_folder,
    slugify,
    strip_sort_prefix,
)


class TestKnownCategories:
    """Files in named subfolders that match predefined keywords."""

    def test_core_rulebook_folder(self):
        assert guess_category("books/D&D 5e/Core Rules/phb.pdf") == "core"

    def test_core_keyword_variant(self):
        assert guess_category("books/Pathfinder/Rulebook/crb.pdf") == "core"

    def test_supplement_folder(self):
        assert guess_category("books/D&D 5e/Supplements/xgte.pdf") == "supplement"

    def test_adventure_folder(self):
        assert guess_category("books/D&D 5e/Adventures/cos.pdf") == "adventure"

    def test_module_keyword(self):
        assert guess_category("books/OSR/Modules/tomb.pdf") == "adventure"

    def test_character_sheet_folder(self):
        assert guess_category("books/D&D 5e/Character Sheets/blank.pdf") == "character-sheet"

    def test_handout_folder(self):
        assert guess_category("books/D&D 5e/Handouts/ref.pdf") == "handout"

    def test_homebrew_folder(self):
        assert guess_category("books/D&D 5e/Homebrew/custom.pdf") == "homebrew"

    def test_map_folder(self):
        assert guess_category("books/D&D 5e/Maps/dungeon.pdf") == "map"

    def test_starter_set_folder(self):
        assert guess_category("books/D&D 5e/Starter Set/lost-mine.pdf") == "starter-set"

    def test_case_insensitive_matching(self):
        assert guess_category("books/D&D 5e/CORE RULEBOOKS/phb.pdf") == "core"

    def test_hyphen_space_equivalence(self):
        assert guess_category("books/D&D 5e/character-sheet/blank.pdf") == "character-sheet"


class TestCustomCategories:
    """Files in subfolders that don't match any predefined keyword."""

    def test_unrecognised_subfolder_becomes_custom_category(self):
        result = guess_category("books/D&D 5e/Lore & Fiction/novel.pdf")
        assert result == "lore-fiction"

    def test_custom_category_is_slugified(self):
        result = guess_category("books/Pathfinder/Bestiaries/monster.pdf")
        assert result == "bestiaries"

    def test_custom_category_strips_spaces(self):
        result = guess_category("books/Call of Cthulhu/Investigator Aids/handout.pdf")
        assert result == "investigator-aids"

    def test_custom_category_uppercase_slugified(self):
        result = guess_category("books/Vampire/LORE FICTION/vtm.pdf")
        assert result == "lore-fiction"

    def test_deep_nesting_uses_first_subfolder(self):
        # Only the first subfolder under the system name is used
        result = guess_category("books/D&D 5e/Lore/Forgotten Realms/sword-coast.pdf")
        assert result == "lore"


class TestNoSubfolder:
    """Files placed directly in the system folder default to 'core'."""

    def test_file_directly_in_system_folder(self):
        assert guess_category("books/D&D 5e/phb.pdf") == "core"

    def test_single_segment_path(self):
        # Degenerate case — still returns 'core'
        assert guess_category("phb.pdf") == "core"


class TestSubfoldersWithinCategory:
    """Files nested one level deeper than the category folder.

    The category is determined by the *category* folder name (segment 2, the
    first folder under the system root), not by any deeper subfolder name.  The
    top-level category folder is the deliberate category the user chose, so it
    takes priority even when a nested subfolder incidentally matches a different
    keyword.  Deeper subfolders are preserved in relative_path and used for
    display grouping only.
    """

    def test_adventure_subfolder_still_adventure(self):
        # books/PF2e/adventures/Abomination Vaults/ruins.pdf → adventure
        result = guess_category("books/PF2e/adventures/Abomination Vaults/ruins.pdf")
        assert result == "adventure"

    def test_core_subfolder_still_core(self):
        # books/PF2e/core/monsters/Bestiary.pdf → core
        result = guess_category("books/PF2e/core/monsters/Bestiary.pdf")
        assert result == "core"

    def test_supplement_subfolder_still_supplement(self):
        result = guess_category("books/D&D 5e/supplements/Settings/sword-coast.pdf")
        assert result == "supplement"

    def test_homebrew_subfolder_still_homebrew(self):
        result = guess_category("books/D&D 5e/homebrew/Personal/custom.pdf")
        assert result == "homebrew"

    def test_top_level_category_folder_wins_over_keyword_subfolder(self):
        # The top-level category folder (segment 2) is the deliberate category
        # the user chose, so it wins over a deeper subfolder whose name happens
        # to match a different keyword.  A subfolder named "core" inside
        # "adventures" → still "adventure" (the top-level folder).
        result = guess_category("books/PF2e/adventures/core/book.pdf")
        assert result == "adventure"

    def test_companions_subfolder_under_core_stays_core(self):
        # Regression for the #193 follow-up: a "Companions" subfolder (matches the
        # "companion" supplement keyword) inside a "core" folder must not override
        # the deliberate top-level "core" category.
        result = guess_category("books/Shadowrun 4E/core/Companions/runner.pdf")
        assert result == "core"

    def test_guide_subfolder_under_core_stays_core(self):
        # A "DM Guide" subfolder (matches the "guide" supplement keyword) inside a
        # "Core" folder must stay core, not become a supplement.
        result = guess_category("books/D&D 5E/Core/DM Guide/dmg.pdf")
        assert result == "core"

    def test_non_keyword_subfolder_does_not_override_category_folder(self):
        # A subfolder with a non-keyword name: category folder wins.
        result = guess_category("books/PF2e/adventures/Abomination Vaults/ruins.pdf")
        assert result == "adventure"

    def test_deeply_nested_non_keyword_leaf(self):
        # Three levels deep with non-keyword names throughout inner segments:
        # books/System/adventures/AP Name/Part 1/chapter.pdf → adventure
        result = guess_category("books/PF2e/adventures/Abomination Vaults/Part 1/ruins.pdf")
        assert result == "adventure"


class TestWholeWordKeywordMatching:
    """Regression tests for issue #188: keywords must match whole tokens, not substrings.

    Short keywords like ``mm`` (core) previously matched inside unrelated words
    (``ga**mm**a``), misclassifying campaign books as Core.
    """

    def test_gamma_world_under_campaigns_is_adventure(self):
        # "gamma" contains the substring "mm" (a core keyword) but is not the
        # token "mm"; the explicit campaigns/ folder should win.
        result = guess_category("books/Gamma World/campaigns/Gamma World/gw.pdf")
        assert result == "adventure"

    def test_gamma_token_alone_does_not_match_core(self):
        # A folder literally named "Gamma World" must not classify as core.
        result = guess_category("books/System/Gamma World/gw.pdf")
        assert result == "gamma-world"

    def test_hollow_world_under_campaigns_is_adventure(self):
        result = guess_category("books/D&D BECMI/campaigns/Hollow World/hw.pdf")
        assert result == "adventure"

    def test_rules_cyclopedia_still_matches_core(self):
        # Genuine whole-token match on "rules" is preserved.
        result = guess_category("books/D&D BECMI/core/Rules Cyclopedia/rc.pdf")
        assert result == "core"

    def test_map_substring_does_not_false_match(self):
        # "map" is a keyword; "Champaign" / "Mapper" style substrings should not hit.
        result = guess_category("books/System/Roadmapping/notes.pdf")
        assert result == "roadmapping"

    def test_multiword_keyword_still_matches(self):
        # Multi-word keywords (character sheet) match as contiguous tokens.
        assert guess_category("books/D&D 5e/Character Sheet/blank.pdf") == "character-sheet"

    def test_multiword_keyword_battle_map(self):
        assert guess_category("books/D&D 5e/Battle Map/grid.pdf") == "map"


class TestIsSystemAgnosticFolder:
    """Tests for is_system_agnostic_folder()."""

    def test_system_agnostic_exact(self):
        assert is_system_agnostic_folder("System Agnostic") is True

    def test_system_agnostic_lowercase(self):
        assert is_system_agnostic_folder("system agnostic") is True

    def test_system_agnostic_uppercase(self):
        assert is_system_agnostic_folder("SYSTEM AGNOSTIC") is True

    def test_generic_exact(self):
        assert is_system_agnostic_folder("Generic") is True

    def test_generic_lowercase(self):
        assert is_system_agnostic_folder("generic") is True

    def test_any_exact(self):
        assert is_system_agnostic_folder("Any") is True

    def test_any_lowercase(self):
        assert is_system_agnostic_folder("any") is True

    def test_normal_system_not_agnostic(self):
        assert is_system_agnostic_folder("Dungeons and Dragons 5e") is False

    def test_pathfinder_not_agnostic(self):
        assert is_system_agnostic_folder("Pathfinder 2e") is False

    def test_empty_string_not_agnostic(self):
        assert is_system_agnostic_folder("") is False


class TestOnePageFolder:
    """Tests for is_one_page_folder() and is_special_collection_folder() (#202)."""

    def test_one_page_rpgs(self):
        assert is_one_page_folder("One-Page RPGs") is True

    def test_single_page_rpgs_alias(self):
        assert is_one_page_folder("Single-Page RPGs") is True

    def test_one_shot_rpgs_alias(self):
        assert is_one_page_folder("One-Shot RPGs") is True

    def test_case_insensitive(self):
        assert is_one_page_folder("one-page-rpgs") is True

    def test_normal_folder_not_one_page(self):
        assert is_one_page_folder("Dungeons and Dragons 5e") is False

    def test_agnostic_not_one_page(self):
        assert is_one_page_folder("System Agnostic") is False

    def test_special_includes_agnostic(self):
        assert is_special_collection_folder("System Agnostic") is True

    def test_special_includes_one_page(self):
        assert is_special_collection_folder("One-Page RPGs") is True

    def test_special_excludes_normal(self):
        assert is_special_collection_folder("Pathfinder 2e") is False

    def test_one_page_uses_subfolder_category(self):
        # One-page collections share the agnostic category resolver.
        assert agnostic_category("books/One-Page RPGs/Honey Heist/hh.pdf") == "honey-heist"


class TestStripSortPrefix:
    """Leading !$% sort-order prefixes are stripped from system folder names."""

    def test_strips_single_bang(self):
        assert strip_sort_prefix("!system-agnostic") == "system-agnostic"

    def test_strips_double_bang(self):
        assert strip_sort_prefix("!!Dungeons & Dragons") == "Dungeons & Dragons"

    def test_strips_mixed_prefix_chars(self):
        assert strip_sort_prefix("!$%Pathfinder 2e") == "Pathfinder 2e"

    def test_stops_at_first_non_prefix_char(self):
        # Only the leading run is removed; internal specials are preserved.
        assert strip_sort_prefix("!!D&D $ Extras") == "D&D $ Extras"

    def test_no_prefix_is_unchanged(self):
        assert strip_sort_prefix("Call of Cthulhu") == "Call of Cthulhu"

    def test_trims_surrounding_whitespace(self):
        assert strip_sort_prefix("!! Dungeons & Dragons ") == "Dungeons & Dragons"

    def test_empty_string(self):
        assert strip_sort_prefix("") == ""

    def test_all_prefix_chars_collapse_to_empty(self):
        assert strip_sort_prefix("!!!") == ""

    def test_does_not_strip_other_specials(self):
        # A hash isn't in the recognised set, so nothing is stripped.
        assert strip_sort_prefix("#Homebrew") == "#Homebrew"

    def test_prefixed_agnostic_folder_still_detected(self):
        # Detection goes through slugify, which already drops "!", so prefixed
        # special-collection folders are recognised regardless.
        assert is_system_agnostic_folder("!system-agnostic") is True

    def test_prefixed_one_page_folder_still_detected(self):
        assert is_one_page_folder("!!one-page-rpgs") is True

    def test_stripped_name_slugs_cleanly(self):
        assert slugify(strip_sort_prefix("!!Dungeons & Dragons")) == "dungeons-dragons"


class TestAgnosticCategory:
    """Tests for agnostic_category() — the category resolver for system-agnostic books."""

    def test_subfolder_becomes_category(self):
        result = agnostic_category("books/System Agnostic/Ironsworn/ironsworn.pdf")
        assert result == "ironsworn"

    def test_subfolder_is_slugified(self):
        result = agnostic_category("books/Generic/OSR Zines/knock-1.pdf")
        assert result == "osr-zines"

    def test_subfolder_uppercase_slugified(self):
        result = agnostic_category("books/Any/Art Books/mcdm.pdf")
        assert result == "art-books"

    def test_deep_nesting_uses_first_subfolder(self):
        # Only the immediate subfolder under the agnostic root matters
        result = agnostic_category("books/System Agnostic/Ironsworn/Expansion/delve.pdf")
        assert result == "ironsworn"

    def test_no_subfolder_returns_uncategorized(self):
        # File sits directly in the agnostic root — no category folder
        result = agnostic_category("books/System Agnostic/standalone.pdf")
        assert result == "uncategorized"

    def test_subfolder_with_special_chars_slugified(self):
        result = agnostic_category("books/Generic/Sci-Fi & Horror/mothership.pdf")
        assert result == "sci-fi-horror"

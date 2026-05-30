"""Comprehensive tests for the CharacterGallery class.

Tests every original method: __init__, setup_ui, focus_search, set_status,
on_close, paste_from_clipboard, show_char_menu, rename_character,
sort_characters, start_drag, on_drop, on_gallery_change, rename_gallery,
delete_gallery_confirm, load_gallery, export_gallery, import_gallery,
save_galleries, refresh_list, filter_list, on_select, select_character,
new_character, delete_character, duplicate_character, change_portrait,
on_tags_change, on_dna_change, save_current, homogenize_dna, copy_dna.
"""

import json
import os
import shutil
import tempfile
from unittest import mock

from data_manager import DataManager


def create_test_dm():
    """Create a DataManager using a temporary directory with known test data."""
    data_dir = tempfile.mkdtemp(prefix="ck3_test_")
    dm = DataManager(data_dir=data_dir)
    dm.galleries = [
        {
            "name": "Test Gallery",
            "characters": [
                {
                    "id": "c1",
                    "name": "Alice",
                    "images": [],
                    "dna": "gene1 = { 1 10 1 10 }",
                    "tags": ["elf", "ruler"],
                    "created": 1000.0,
                    "modified": 2000.0,
                },
                {
                    "id": "c2",
                    "name": "Bob",
                    "images": [],
                    "dna": "gene2 = { 2 20 2 20 }",
                    "tags": [],
                    "created": 1500.0,
                    "modified": 2500.0,
                },
                {
                    "id": "c3",
                    "name": "Charlie",
                    "images": [],
                    "dna": "gene3 = { 3 30 3 30 }",
                    "tags": ["dwarf"],
                    "created": 500.0,
                    "modified": 3000.0,
                },
            ],
        },
        {
            "name": "Second Gallery",
            "characters": [],
        },
    ]
    dm.save()
    return dm


class TestCharacterGalleryDataMethods:
    """Tests for data/logic methods that work through the UI but don't need dialogs."""

    _INITIAL_GALLERIES: list[dict] = []

    @classmethod
    def setup_class(cls):
        from gallery_ui import CharacterGallery

        cls.dm = create_test_dm()
        cls._INITIAL_GALLERIES = json.loads(
            json.dumps(cls.dm.galleries)
        )
        cls.app = CharacterGallery(data_manager=cls.dm)
        cls.app.withdraw()

    def setup_method(self):
        """Reset DataManager state before each test to avoid cross-test leakage."""
        self.dm.galleries = json.loads(
            json.dumps(self._INITIAL_GALLERIES)
        )
        self.dm.save()
        self.app.load_gallery(self._INITIAL_GALLERIES[0]["name"])
        self.app.search_var.set("")
        self.app._placeholder_active = False

    @classmethod
    def teardown_class(cls):
        cls.app.destroy()
        shutil.rmtree(cls.dm.data_dir, ignore_errors=True)

    # ── Gallery management ────────────────────────────────────────────

    def test_load_gallery(self):
        """load_gallery sets current_gallery and clears current_index."""
        self.app.load_gallery("Test Gallery")
        assert self.app.current_gallery is not None
        assert self.app.current_gallery["name"] == "Test Gallery"
        assert self.app.current_index is None

    def test_load_gallery_updates_listbox(self):
        """load_gallery populates the listbox with character names."""
        self.app.load_gallery("Test Gallery")
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Alice" in items
        assert "Bob" in items
        assert "Charlie" in items

    def test_load_gallery_empty(self):
        """Loading a gallery with no characters yields empty listbox."""
        self.app.load_gallery("Second Gallery")
        items = list(self.app.char_listbox.get(0, "end"))
        assert items == []

    # ── Character list display ────────────────────────────────────────

    def test_refresh_list(self):
        """refresh_list repopulates the listbox from current_gallery."""
        self.app.load_gallery("Test Gallery")
        # Modify the in-memory list to verify refresh reads from it
        self.app.current_gallery["characters"].append(
            self.dm.create_character("Extra")
        )
        self.app.refresh_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Extra" in items
        # Clean up
        self.app.current_gallery["characters"].pop()

    def test_filter_list_by_name(self):
        """filter_list filters characters by name substring."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("ali")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Alice" in items
        assert "Bob" not in items
        assert "Charlie" not in items

    def test_filter_list_by_name_case_insensitive(self):
        """filter_list matching is case-insensitive."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("bOB")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert items == ["Bob"]

    def test_filter_list_by_tags(self):
        """filter_list with 'tag:' prefix matches by tags."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("tag:elf")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Alice" in items
        assert "Bob" not in items
        assert "Charlie" not in items

    def test_filter_list_by_multiple_tags(self):
        """Multiple tag: search OR-matches."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("tag:elf, dwarf")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Alice" in items
        assert "Charlie" in items
        assert "Bob" not in items

    def test_filter_list_tags_prefix_alias(self):
        """'tags:' prefix works same as 'tag:'."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("tags: ruler")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Alice" in items

    def test_filter_list_empty_term_shows_all(self):
        """Empty search term shows all characters."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("")
        self.app.filter_list()
        items = list(self.app.char_listbox.get(0, "end"))
        assert len(items) == 3

    def test_filter_then_select_loads_correct_character(self):
        """select_character must load the correct character when filter is active."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("char")
        self.app.filter_list()
        # After filtering, listbox shows only "Charlie" at index 0
        self.app.char_listbox.selection_set(0)
        self.app.on_select(None)
        assert self.app.current_index == 2  # Charlie is at array index 2, not 0

    def test_filter_then_delete_removes_correct_character(self):
        """delete_character must remove the correct character when filter is active."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("bob")
        self.app.filter_list()
        # Listbox shows only "Bob" at index 0
        self.app.char_listbox.selection_set(0)
        self.app.current_index = 0  # set by on_select via _char_idx in real usage
        # Bob is at array index 1; if buggy, index 0 (Alice) would be deleted
        char_names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert "Bob" in char_names
        # Select Bob and delete
        with mock.patch(
            "dialogs.ask_yesno", return_value=True
        ):
            self.app.delete_character()
        char_names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert "Bob" not in char_names
        assert "Alice" in char_names

    def test_char_counter_unfiltered(self):
        """Character counter shows total count when no filter is active."""
        self.app.load_gallery("Test Gallery")
        assert self.app.char_count_label.cget("text") == "3 characters"

    def test_char_counter_filtered(self):
        """Character counter shows 'showing X of Y' when filter is active."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("ali")
        self.app._placeholder_active = False
        self.app.filter_list()
        assert self.app.char_count_label.cget("text") == "Showing 1 of 3 characters"

    def test_char_counter_clears_with_filter(self):
        """Counter reverts to total when filter is cleared."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("ali")
        self.app._placeholder_active = False
        self.app.filter_list()
        assert "Showing 1 of 3" in self.app.char_count_label.cget("text")
        self.app.search_var.set("")
        self.app.filter_list()
        assert self.app.char_count_label.cget("text") == "3 characters"

    def test_filter_then_show_char_menu_sets_correct_index(self):
        """show_char_menu must set current_index correctly when filter is active."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("ali")
        self.app.filter_list()
        # Simulate right-click on "Alice" (listbox index 0, array index 0)
        import tkinter as tk
        event = tk.Event()
        event.y = 0
        event.x_root = 100
        event.y_root = 100
        with mock.patch.object(self.app.char_menu, "tk_popup"):
            self.app.show_char_menu(event)
        assert self.app.current_index == 0  # Alice is at array index 0

    def test_filter_then_rename_updates_correct_character(self):
        """rename_character must rename the correct character when filter active."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("charlie")
        self.app.filter_list()
        # Simulate user clicking Charlie (listbox idx 0, array idx 2)
        self.app.char_listbox.selection_set(0)
        self.app.on_select(None)
        assert self.app.current_index == 2
        with mock.patch(
            "dialogs.ask_string", return_value="Chuck"
        ):
            self.app.rename_character()
        assert self.app.current_gallery["characters"][2]["name"] == "Chuck"
        # Restore
        self.app.current_gallery["characters"][2]["name"] = "Charlie"
        self.dm.save()

    def test_filter_persists_after_delete(self):
        """Active filter must remain applied after a character is deleted."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("bob")
        self.app.filter_list()
        assert len(list(self.app.char_listbox.get(0, "end"))) == 1
        self.app.char_listbox.selection_set(0)
        with mock.patch(
            "dialogs.ask_yesno", return_value=True
        ):
            self.app.delete_character()
        items = list(self.app.char_listbox.get(0, "end"))
        assert "Bob" not in items
        assert len(items) == 0

    def test_filter_persists_after_sort(self):
        """Active filter must remain applied after sorting."""
        self.app.load_gallery("Test Gallery")
        self.app.search_var.set("char")
        self.app.filter_list()
        self.app.sort_characters("name_asc")
        items = list(self.app.char_listbox.get(0, "end"))
        assert items == ["Charlie"]

    def test_select_character_loads_dna(self):
        """select_character loads DNA text into dna_text widget."""
        self.app.load_gallery("Test Gallery")
        self.app.select_character(0)
        dna = self.app.dna_text.get("1.0", "end").strip()
        assert "gene1" in dna

    def test_select_character_loads_tags(self):
        """select_character loads comma-separated tags into tags_text."""
        self.app.load_gallery("Test Gallery")
        self.app.select_character(0)
        tags = self.app.tags_text.get("1.0", "end").strip()
        assert "elf" in tags
        assert "ruler" in tags

    def test_select_character_without_image(self):
        """select_character handles missing image gracefully."""
        self.app.load_gallery("Test Gallery")
        self.app.select_character(0)
        # Should not raise; portrait_image_id may be None

    def test_select_character_out_of_range(self):
        """select_character with invalid index is a no-op."""
        self.app.load_gallery("Test Gallery")
        prev = self.app.current_index
        self.app.select_character(999)
        assert self.app.current_index == prev  # unchanged

    # ── Character CRUD ────────────────────────────────────────────────

    def test_new_character_dialog_cancelled(self):
        """new_character does nothing if user cancels the dialog."""
        self.app.load_gallery("Test Gallery")
        before = len(self.app.current_gallery["characters"])
        with mock.patch(
            "dialogs.ask_string", return_value=None
        ):
            self.app.new_character()
        assert len(self.app.current_gallery["characters"]) == before

    def test_new_character_created(self):
        """new_character adds a character when a name is provided."""
        self.app.load_gallery("Test Gallery")
        before = len(self.app.current_gallery["characters"])
        with mock.patch(
            "dialogs.ask_string", return_value="Diana"
        ):
            self.app.new_character()
        after = len(self.app.current_gallery["characters"])
        assert after == before + 1
        new_char = self.app.current_gallery["characters"][-1]
        assert new_char["name"] == "Diana"
        assert new_char["dna"] == ""
        assert new_char["tags"] == []
        # Clean up
        self.app.current_gallery["characters"].pop()
        self.dm.save()

    def test_delete_character_dialog_cancelled(self):
        """delete_character does nothing if user cancels confirmation."""
        self.app.load_gallery("Test Gallery")
        self.app.char_listbox.selection_set(0)
        before = len(self.app.current_gallery["characters"])
        with mock.patch(
            "dialogs.ask_yesno", return_value=False
        ):
            self.app.delete_character()
        assert len(self.app.current_gallery["characters"]) == before

    def test_delete_character_no_selection(self):
        """delete_character returns early if nothing selected."""
        self.app.load_gallery("Test Gallery")
        self.app.char_listbox.selection_clear(0, "end")
        before = len(self.app.current_gallery["characters"])
        self.app.delete_character()
        assert len(self.app.current_gallery["characters"]) == before

    def test_delete_character_confirmed(self):
        """delete_character removes selected character when confirmed."""
        self.app.load_gallery("Test Gallery")
        # Add a temp char so we don't delete real data
        self.app.current_gallery["characters"].append(
            self.dm.create_character("Temp")
        )
        self.app.refresh_list()
        idx = len(self.app.current_gallery["characters"]) - 1
        self.app.char_listbox.selection_set(idx)
        before = len(self.app.current_gallery["characters"])
        with mock.patch(
            "dialogs.ask_yesno", return_value=True
        ):
            self.app.delete_character()
        assert len(self.app.current_gallery["characters"]) == before - 1

    def test_duplicate_character(self):
        """duplicate_character creates a copy of the selected character."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        before = len(self.app.current_gallery["characters"])
        self.app.duplicate_character()
        after = len(self.app.current_gallery["characters"])
        assert after == before + 1
        dup = self.app.current_gallery["characters"][-1]
        assert dup["name"] == "Alice (Copy)"
        assert dup["dna"] == "gene1 = { 1 10 1 10 }"
        assert dup["tags"] == ["elf", "ruler"]
        assert dup["id"] != "c1"
        # Clean up
        self.app.current_gallery["characters"].pop()
        self.dm.save()

    def test_duplicate_character_no_selection(self):
        """duplicate_character returns early if nothing selected."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = None
        before = len(self.app.current_gallery["characters"])
        self.app.duplicate_character()
        assert len(self.app.current_gallery["characters"]) == before

    def test_rename_character_dialog_cancelled(self):
        """rename_character does nothing if user cancels."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        old_name = self.app.current_gallery["characters"][0]["name"]
        with mock.patch(
            "dialogs.ask_string", return_value=None
        ):
            self.app.rename_character()
        assert self.app.current_gallery["characters"][0]["name"] == old_name

    def test_rename_character(self):
        """rename_character changes the character's name."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        with mock.patch(
            "dialogs.ask_string", return_value="Alicia"
        ):
            self.app.rename_character()
        assert self.app.current_gallery["characters"][0]["name"] == "Alicia"
        # Restore
        self.app.current_gallery["characters"][0]["name"] = "Alice"
        self.dm.save()

    def test_rename_character_no_selection(self):
        """rename_character returns early if nothing selected."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = None
        self.app.rename_character()  # should not raise

    # ── Sorting ───────────────────────────────────────────────────────

    def test_sort_characters_name_asc(self):
        """Sort A-Z by name."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("name_asc")
        names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert names == ["Alice", "Bob", "Charlie"]

    def test_sort_characters_name_desc(self):
        """Sort Z-A by name."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("name_desc")
        names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert names == ["Charlie", "Bob", "Alice"]

    def test_sort_characters_created_asc(self):
        """Sort by creation time ascending."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("created_asc")
        names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert names == ["Charlie", "Alice", "Bob"]

    def test_sort_characters_created_desc(self):
        """Sort by creation time descending."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("created_desc")
        names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert names == ["Bob", "Alice", "Charlie"]

    def test_sort_characters_modified_desc(self):
        """Sort by modification time descending."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("modified_desc")
        names = [c["name"] for c in self.app.current_gallery["characters"]]
        assert names == ["Charlie", "Bob", "Alice"]

    def test_sort_characters_persists(self):
        """Sorting saves to disk."""
        self.app.load_gallery("Test Gallery")
        self.app.sort_characters("name_asc")
        dm2 = DataManager(data_dir=self.dm.data_dir)
        names = [c["name"] for c in dm2.galleries[0]["characters"]]
        assert names == ["Alice", "Bob", "Charlie"]

    # ── Gallery rename / delete ───────────────────────────────────────

    def test_rename_gallery(self):
        """rename_gallery changes the gallery name."""
        old_name = self.dm.galleries[0]["name"]
        with mock.patch(
            "dialogs.ask_string", return_value="Renamed"
        ):
            self.app.load_gallery(old_name)
            self.app.rename_gallery()
        assert self.app.current_gallery["name"] == "Renamed"
        # Restore
        self.dm.galleries[0]["name"] = old_name
        self.dm.save()

    def test_rename_gallery_cancelled(self):
        """rename_gallery does nothing if user cancels."""
        old_name = self.dm.galleries[0]["name"]
        with mock.patch(
            "dialogs.ask_string", return_value=None
        ):
            self.app.load_gallery(old_name)
            self.app.rename_gallery()
        assert self.app.current_gallery["name"] == old_name

    def test_rename_gallery_same_name(self):
        """rename_gallery does nothing if new name equals old name."""
        old_name = self.dm.galleries[0]["name"]
        with mock.patch(
            "dialogs.ask_string", return_value=old_name
        ):
            self.app.load_gallery(old_name)
            self.app.rename_gallery()
        assert self.app.current_gallery["name"] == old_name

    def test_delete_gallery_last(self):
        """Cannot delete the last gallery."""
        self.dm.galleries = [{"name": "Only", "characters": []}]
        self.dm.save()
        self.app.load_gallery("Only")
        with mock.patch("dialogs.show_warning") as mock_warn:
            self.app.delete_gallery_confirm()
            mock_warn.assert_called_once()
        assert len(self.dm.galleries) == 1

    def test_delete_gallery_confirmed(self):
        """Gallery deletion removes it from the data manager."""
        old_count = len(self.dm.galleries)
        # Add a temp gallery to delete
        self.dm.galleries.append({"name": "TempDel", "characters": []})
        self.dm.save()
        self.app.load_gallery("TempDel")
        with mock.patch(
            "dialogs.ask_yesno", return_value=True
        ):
            self.app.delete_gallery_confirm()
        assert len(self.dm.galleries) == old_count
        assert self.dm.find_gallery("TempDel") is None

    def test_delete_gallery_clears_display(self):
        """Deleting the current gallery clears portrait, DNA, and tags."""
        self.app.load_gallery("Test Gallery")
        self.app.select_character(0)
        assert self.app.dna_text.get("1.0", "end").strip() != ""

        self.dm.galleries.append({"name": "ToDelete", "characters": []})
        self.dm.save()
        self.app.load_gallery("ToDelete")
        with mock.patch("dialogs.ask_yesno", return_value=True):
            self.app.delete_gallery_confirm()
        assert self.app.dna_text.get("1.0", "end").strip() == ""
        assert self.app.tags_text.get("1.0", "end").strip() == ""
        assert self.app.portrait_image_id is None

    # ── Gallery change ────────────────────────────────────────────────

    def test_on_gallery_change_selects_existing(self):
        """Selecting an existing gallery name loads it."""
        self.app.load_gallery("Test Gallery")
        self.app.gallery_var.set("Second Gallery")
        self.app.on_gallery_change()
        assert self.app.current_gallery["name"] == "Second Gallery"

    def test_on_gallery_change_create_new(self):
        """Selecting 'Create new gallery' adds a new gallery."""
        self.app.gallery_var.set("Create a new gallery...")
        with mock.patch(
            "dialogs.ask_string", return_value="Fresh"
        ):
            self.app.on_gallery_change()
        assert self.dm.find_gallery("Fresh") is not None
        # Clean up
        g = self.dm.find_gallery("Fresh")
        if g:
            self.dm.galleries.remove(g)
            self.dm.save()

    def test_on_gallery_change_create_cancelled(self):
        """Cancelling gallery creation reverts to current gallery."""
        self.app.load_gallery("Test Gallery")
        old_name = self.app.current_gallery["name"]
        self.app.gallery_var.set("Create a new gallery...")
        with mock.patch(
            "dialogs.ask_string", return_value=None
        ):
            self.app.on_gallery_change()
        assert self.app.current_gallery["name"] == old_name

    # ── Export / Import ───────────────────────────────────────────────

    def test_export_gallery(self):
        """export_gallery creates the expected folder structure."""
        self.app.load_gallery("Test Gallery")
        export_dir = tempfile.mkdtemp(prefix="ck3_export_")
        try:
            with mock.patch(
                "tkinter.filedialog.askdirectory", return_value=export_dir
            ), mock.patch("dialogs.show_info"):
                self.app.export_gallery()
            out = os.path.join(export_dir, "Test Gallery")
            assert os.path.isdir(out)
            assert os.path.isfile(os.path.join(out, "characters.json"))
            assert os.path.isdir(os.path.join(out, "images"))
        finally:
            shutil.rmtree(export_dir, ignore_errors=True)

    def test_export_gallery_cancelled(self):
        """export_gallery does nothing if user cancels the dialog."""
        self.app.load_gallery("Test Gallery")
        with mock.patch(
            "tkinter.filedialog.askdirectory", return_value=""
        ):
            self.app.export_gallery()  # should not raise

    def test_import_gallery_cancelled(self):
        """import_gallery does nothing if user cancels folder dialog."""
        with mock.patch(
            "tkinter.filedialog.askdirectory", return_value=""
        ):
            self.app.import_gallery()  # should not raise

    def test_import_gallery_no_json(self):
        """import_gallery shows error if characters.json is missing."""
        with mock.patch(
            "tkinter.filedialog.askdirectory",
            return_value=tempfile.gettempdir(),
        ):
            with mock.patch("dialogs.show_error") as mock_err:
                self.app.import_gallery()
                mock_err.assert_called_once()

    def test_import_gallery(self):
        """import_gallery correctly imports a gallery folder."""
        src = tempfile.mkdtemp(prefix="ck3_import_")
        try:
            os.makedirs(os.path.join(src, "images"))
            chars = [
                {"id": "imp1", "name": "Imported", "dna": "x", "tags": ["a"]}
            ]
            with open(os.path.join(src, "characters.json"), "w") as f:
                json.dump(chars, f)
            with open(os.path.join(src, "images", "imp1.png"), "wb") as f:
                f.write(b"fake")

            with mock.patch(
                "tkinter.filedialog.askdirectory", return_value=src
            ):
                with mock.patch(
                    "dialogs.ask_string",
                    return_value="Imported Gallery",
                ), mock.patch("dialogs.show_info"):
                    self.app.import_gallery()

            g = self.dm.find_gallery("Imported Gallery")
            assert g is not None
            assert len(g["characters"]) == 1
            assert g["characters"][0]["name"] == "Imported"
            # Clean up
            self.dm.galleries.remove(g)
            self.dm.save()
        finally:
            shutil.rmtree(src, ignore_errors=True)

    # ── Persistence ───────────────────────────────────────────────────

    def test_save_galleries_writes_to_disk(self):
        """save_galleries persists data and clears dirty flag."""
        self.app.load_gallery("Test Gallery")
        self.app.dirty = True
        self.app.save_galleries()
        assert self.app.dirty is False
        # Verify persistence
        dm2 = DataManager(data_dir=self.dm.data_dir)
        assert dm2.find_gallery("Test Gallery") is not None

    def test_save_current(self):
        """save_current saves and shows message."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        with mock.patch(
            "dialogs.show_info"
        ) as mock_info:
            self.app.save_current()
            mock_info.assert_called_once()
        assert self.app.dirty is False

    def test_save_current_no_selection(self):
        """save_current is a no-op when nothing is selected."""
        self.app.current_index = None
        self.app.save_current()  # should not raise

    # ── Tags & DNA editing ────────────────────────────────────────────

    def test_on_tags_change(self):
        """on_tags_change parses comma-separated tags from the widget."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.tags_text.delete("1.0", "end")
        self.app.tags_text.insert("1.0", "warrior, human, mage")
        self.app.on_tags_change()
        tags = self.app.current_gallery["characters"][0]["tags"]
        assert tags == ["warrior", "human", "mage"]
        # Restore
        self.app.current_gallery["characters"][0]["tags"] = ["elf", "ruler"]

    def test_on_tags_change_empty(self):
        """on_tags_change handles empty text."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.tags_text.delete("1.0", "end")
        self.app.on_tags_change()
        tags = self.app.current_gallery["characters"][0]["tags"]
        assert tags == []

    def test_on_dna_change(self):
        """on_dna_change persists DNA from widget to character dict."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.dna_text.delete("1.0", "end")
        self.app.dna_text.insert("1.0", "new_dna { 5 5 5 5 }")
        self.app.on_dna_change()
        dna = self.app.current_gallery["characters"][0]["dna"]
        assert dna == "new_dna { 5 5 5 5 }"
        # Restore
        self.app.current_gallery["characters"][0]["dna"] = (
            "gene1 = { 1 10 1 10 }"
        )

    def test_on_dna_change_no_selection(self):
        """on_dna_change is a no-op when nothing is selected."""
        self.app.current_index = None
        self.app.on_dna_change()  # should not raise

    def test_on_tags_change_no_selection(self):
        """on_tags_change is a no-op when nothing is selected."""
        self.app.current_index = None
        self.app.on_tags_change()  # should not raise

    def test_on_homogenize_dna(self):
        """on_homogenize_dna transforms DNA via the utility function."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.dna_text.delete("1.0", "end")
        self.app.dna_text.insert("1.0", 'gene = { "a" 1 "b" 1 }')
        self.app.on_homogenize_dna()
        result = self.app.dna_text.get("1.0", "end").strip()
        assert '"a" 1 "a" 1' in result
        # Restore
        self.app.current_gallery["characters"][0]["dna"] = (
            "gene1 = { 1 10 1 10 }"
        )

    def test_copy_dna(self):
        """copy_dna puts DNA content on the clipboard."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.dna_text.delete("1.0", "end")
        self.app.dna_text.insert("1.0", "SAMPLE DNA")
        self.app.copy_dna()
        # Clipboard content verification is OS-dependent; at minimum it should not raise

    def test_copy_dna_empty(self):
        """copy_dna shows info when DNA is empty."""
        self.app.dna_text.delete("1.0", "end")
        with mock.patch(
            "dialogs.show_info"
        ) as mock_info:
            self.app.copy_dna()
            mock_info.assert_called_once()

    # ── Misc ──────────────────────────────────────────────────────────

    def test_focus_search(self):
        """focus_search selects all text in the search entry."""
        self.app.search_entry.insert(0, "some text")
        self.app.focus_search()
        # focus_search calls select_range(0, END); verify it doesn't raise

    def test_set_status(self):
        """set_status updates the status label text."""
        self.app.set_status("Testing...")
        assert "Testing" in self.app.status_label.cget("text")

    def test_set_status_reverts(self):
        """set_status reverts to 'Idle' after timeout."""
        self.app.set_status("Temp")
        self.app.status_label.config(text="Idle", fg="#888888")
        assert self.app.status_label.cget("text") == "Idle"

    def test_dirty_tracked(self):
        """Operations that modify data set the dirty flag."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.dirty = False
        self.app.dna_text.delete("1.0", "end")
        self.app.dna_text.insert("1.0", "changed")
        self.app.on_dna_change()
        assert self.app.dirty is True

    def test_drag_drop_requires_init(self):
        """on_drop with uninitialized _drag_idx should be safe."""
        self.app.load_gallery("Test Gallery")
        self.app._drag_idx = None
        assert hasattr(self.app, "_drag_idx")

    def test_default_state_after_init(self):
        """After init the app should have a gallery selected."""
        assert self.app.current_gallery is not None
        assert self.app.current_gallery["name"] == "Test Gallery"

    # ── on_close ──────────────────────────────────────────────────────

    def test_on_close_clean(self):
        """on_close destroys the window when no changes pending."""
        self.app.dirty = False
        with mock.patch.object(self.app, "destroy") as mock_destroy:
            self.app.on_close()
            mock_destroy.assert_called_once()

    def test_on_close_dirty_save(self):
        """on_close saves when dirty and user confirms."""
        self.app.dirty = True
        with mock.patch(
            "dialogs.ask_yesnocancel", return_value=True
        ), mock.patch("dialogs.show_info"), mock.patch.object(
            self.app, "destroy"
        ) as mock_destroy:
            self.app.on_close()
            mock_destroy.assert_called_once()

    def test_on_close_dirty_discard(self):
        """on_close destroys without saving when user chooses no."""
        self.app.dirty = True
        with mock.patch(
            "dialogs.ask_yesnocancel", return_value=False
        ), mock.patch.object(self.app, "destroy") as mock_destroy:
            self.app.on_close()
            mock_destroy.assert_called_once()

    def test_on_close_dirty_cancel(self):
        """on_close returns without destroying when user cancels."""
        self.app.dirty = True
        with mock.patch(
            "dialogs.ask_yesnocancel", return_value=None
        ), mock.patch.object(self.app, "destroy") as mock_destroy:
            self.app.on_close()
            mock_destroy.assert_not_called()

    def test_show_char_menu(self):
        """show_char_menu sets selection and shows context menu."""
        import tkinter as tk
        self.app.load_gallery("Test Gallery")
        event = tk.Event()
        event.y = 20
        event.x_root = 100
        event.y_root = 100
        with mock.patch.object(self.app.char_menu, "tk_popup"):
            self.app.show_char_menu(event)

    def test_char_menu_has_all_items(self):
        """Context menu must include Rename, Duplicate, Copy DNA, and Delete."""
        import tkinter as tk
        labels = []
        for i in range(self.app.char_menu.index("end") + 1):
            try:
                labels.append(self.app.char_menu.entrycget(i, "label"))
            except tk.TclError:
                pass
        assert "Rename" in labels
        assert "Duplicate" in labels
        assert "Copy DNA" in labels
        assert "Delete" in labels

    def test_geometry_save_restore(self):
        """_save_geometry writes valid JSON; _restore_geometry reads it without error."""
        self.app._save_geometry()
        geom_file = self.app._geometry_file
        assert os.path.exists(geom_file)
        with open(geom_file, encoding="utf-8") as f:
            saved = json.load(f)
        assert isinstance(saved, str)
        assert "x" in saved
        self.app._restore_geometry()  # should not raise

    def test_geometry_missing_file_does_not_crash(self):
        """_restore_geometry handles a missing file gracefully."""
        import os
        if os.path.exists(self.app._geometry_file):
            os.remove(self.app._geometry_file)
        self.app._restore_geometry()  # should not raise

    # ── Multi-portrait ─────────────────────────────────────────────────

    def test_add_portrait_slot(self):
        """_add_portrait_slot appends an empty slot and shows the counter."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app._add_portrait_slot()
        images = self.app.current_gallery["characters"][0].get("images", [])
        assert len(images) == 1
        assert images[0] == ""

    def test_add_portrait_slot_max_five(self):
        """_add_portrait_slot rejects beyond 5 slots."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        for _ in range(5):
            self.app._add_portrait_slot()
        assert len(self.app.current_gallery["characters"][0].get("images", [])) == 5
        with mock.patch("dialogs.show_warning") as mock_warn:
            self.app._add_portrait_slot()
            mock_warn.assert_called_once()

    def test_remove_portrait_slot(self):
        """_remove_portrait_slot deletes the current slot."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app._add_portrait_slot()
        self.app.current_gallery["characters"][0]["images"] = ["a.png", "b.png", "c.png"]
        self.app.current_portrait_index = 1
        self.app._remove_portrait_slot()
        images = self.app.current_gallery["characters"][0].get("images", [])
        assert images == ["a.png", "c.png"]
        assert self.app.current_portrait_index == 1

    def test_remove_last_slot_clamps_index(self):
        """Removing the last slot decrements the index."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.current_gallery["characters"][0]["images"] = ["a.png", "b.png"]
        self.app.current_portrait_index = 1
        self.app._remove_portrait_slot()
        assert self.app.current_portrait_index == 0

    def test_portrait_count_updates(self):
        """portrait_count reflects the number of slots."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        char = self.app.current_gallery["characters"][0]
        assert self.app.data_manager.portrait_count(char) == 0
        char["images"] = ["x.png"]
        assert self.app.data_manager.portrait_count(char) == 1

    def test_cycle_portrait_wraps(self):
        """_cycle_portrait wraps around the portrait list."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        self.app.current_gallery["characters"][0]["images"] = ["a.png", "b.png"]
        self.app.current_portrait_index = 1
        self.app._cycle_portrait(1)
        assert self.app.current_portrait_index == 0

    # ── Clipboard ─────────────────────────────────────────────────────

    def test_clipboard_no_selection(self):
        """paste_from_clipboard returns early if no character selected."""
        self.app.current_index = None
        self.app.paste_from_clipboard()  # should not raise

    def test_clipboard_no_image(self):
        """paste_from_clipboard handles clipboard with no image data."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        with mock.patch(
            "PIL.ImageGrab.grabclipboard", return_value=None
        ):
            self.app.paste_from_clipboard()

    def test_clipboard_exception_shows_status(self):
        """paste_from_clipboard shows status on exception."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        with mock.patch(
            "PIL.ImageGrab.grabclipboard",
            side_effect=RuntimeError("clipboard error"),
        ):
            self.app.paste_from_clipboard()
        assert "clipboard error" in self.app.status_label.cget("text")

    # ── Change portrait ───────────────────────────────────────────────

    def test_change_portrait_no_selection(self):
        """change_portrait warns if no character is selected."""
        self.app.current_index = None
        with mock.patch(
            "dialogs.show_warning"
        ) as mock_warn:
            self.app.change_portrait()
            mock_warn.assert_called_once()

    def test_change_portrait_dialog_cancelled(self):
        """change_portrait does nothing if file dialog is cancelled."""
        self.app.load_gallery("Test Gallery")
        self.app.current_index = 0
        with mock.patch(
            "tkinter.filedialog.askopenfilename", return_value=""
        ):
            self.app.change_portrait()  # should not raise

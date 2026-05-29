"""Unit tests for the CK3 Character Gallery.

Run with: python -m pytest tests/ -v
"""

import json
import os
import shutil
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from data_manager import DataManager  # noqa: E402
from utils import homogenize_dna  # noqa: E402


# ---------------------------------------------------------------------------
# DataManager tests
# ---------------------------------------------------------------------------

class TestDataManager:
    """Tests for the DataManager class."""

    @pytest.fixture
    def dm(self, tmp_path):
        """Create a DataManager that uses a temporary directory for storage."""
        dm = DataManager(data_dir=str(tmp_path / "test_data"))
        return dm

    def test_initialises_with_default_gallery(self, dm):
        """A fresh DataManager should create a default gallery."""
        assert len(dm.galleries) == 1
        assert dm.galleries[0]["name"] == "Default"
        assert dm.galleries[0]["characters"] == []

    def test_save_and_reload(self, dm):
        """Data should persist after save() and reload via a new DataManager."""
        dm.galleries.append({"name": "Extra", "characters": []})
        dm.save()
        dm2 = DataManager(data_dir=dm.data_dir)
        assert len(dm2.galleries) == 2
        assert dm2.galleries[1]["name"] == "Extra"

    def test_find_gallery_found(self, dm):
        """find_gallery returns the gallery dict when it exists."""
        g = dm.find_gallery("Default")
        assert g is not None
        assert g["name"] == "Default"

    def test_find_gallery_missing(self, dm):
        """find_gallery returns None for non-existent galleries."""
        assert dm.find_gallery("Nonexistent") is None

    def test_get_gallery_names(self, dm):
        """get_gallery_names returns all gallery names."""
        dm.galleries.append({"name": "Test", "characters": []})
        names = dm.get_gallery_names()
        assert names == ["Default", "Test"]

    def test_get_gallery_choices(self, dm):
        """get_gallery_choices includes the create-new sentinel."""
        choices = dm.get_gallery_choices()
        assert "Create a new gallery..." in choices
        assert len(choices) == len(dm.galleries) + 1

    def test_get_image_path(self, dm):
        """get_image_path returns a path inside the data dir."""
        path = dm.get_image_path("abc-123")
        assert path.endswith("abc-123.png")
        assert "test_data" in path
        assert "images" in path

    def test_copy_image_to_storage(self, dm):
        """copy_image_to_storage copies a file to the images directory."""
        src_dir = os.path.join(dm.data_dir, "temp_src")
        os.makedirs(src_dir, exist_ok=True)
        src = os.path.join(src_dir, "test.png")
        with open(src, "wb") as f:
            f.write(b"fake-png-data")

        dest = dm.copy_image_to_storage(src, "char-1")
        assert os.path.exists(dest)
        assert os.path.basename(dest) == "char-1.png"
        assert dest.startswith(os.path.join(dm.data_dir, "images"))

    def test_delete_image_existing(self, dm):
        """delete_image removes an existing file."""
        img_dir = os.path.join(dm.data_dir, "images")
        os.makedirs(img_dir, exist_ok=True)
        path = os.path.join(img_dir, "test.png")
        with open(path, "wb") as f:
            f.write(b"data")
        assert os.path.exists(path)
        dm.delete_image(path)
        assert not os.path.exists(path)

    def test_delete_image_none(self, dm):
        """delete_image handles None without error."""
        dm.delete_image(None)

    def test_delete_image_missing(self, dm):
        """delete_image handles a non-existent path without error."""
        dm.delete_image("nonexistent.png")

    def test_delete_gallery_images(self, dm):
        """delete_gallery_images removes all character images in a gallery."""
        img_dir = os.path.join(dm.data_dir, "images")
        os.makedirs(img_dir, exist_ok=True)
        path1 = os.path.join(img_dir, "c1.png")
        path2 = os.path.join(img_dir, "c2.png")
        with open(path1, "wb") as f:
            f.write(b"x")
        with open(path2, "wb") as f:
            f.write(b"x")

        gallery = {
            "name": "Test",
            "characters": [
                {"id": "c1", "image": path1},
                {"id": "c2", "image": path2},
            ],
        }
        dm.delete_gallery_images(gallery)
        assert not os.path.exists(path1)
        assert not os.path.exists(path2)

    def test_export_gallery(self, dm):
        """export_gallery creates a folder with JSON and images."""
        img_dir = os.path.join(dm.data_dir, "images")
        os.makedirs(img_dir, exist_ok=True)
        img_path = os.path.join(img_dir, "char1.png")
        with open(img_path, "wb") as f:
            f.write(b"png-data")

        gallery = {
            "name": "ExportTest",
            "characters": [
                {"id": "char1", "name": "Foo", "image": img_path, "dna": "", "tags": []}
            ],
        }
        export_parent = os.path.join(dm.data_dir, "exports")
        os.makedirs(export_parent, exist_ok=True)

        out = dm.export_gallery(gallery, export_parent)
        expected = os.path.join(export_parent, "ExportTest")
        assert out == expected
        assert os.path.exists(os.path.join(expected, "characters.json"))
        assert os.path.exists(os.path.join(expected, "images", "char1.png"))

    def test_import_gallery(self, dm):
        """import_gallery reads a folder and appends a new gallery."""
        src_dir = os.path.join(dm.data_dir, "import_src")
        os.makedirs(os.path.join(src_dir, "images"), exist_ok=True)
        char_data = [
            {"id": "xyz", "name": "Alice", "dna": "gene=1", "tags": ["elf"]}
        ]
        with open(os.path.join(src_dir, "characters.json"), "w") as f:
            json.dump(char_data, f)
        img_path = os.path.join(src_dir, "images", "xyz.png")
        with open(img_path, "wb") as f:
            f.write(b"png-data")

        dm.import_gallery(src_dir, "Imported")
        assert len(dm.galleries) == 2
        imported = dm.galleries[1]
        assert imported["name"] == "Imported"
        assert len(imported["characters"]) == 1
        assert imported["characters"][0]["name"] == "Alice"
        assert imported["characters"][0]["image"] is not None

    def test_create_character_has_required_fields(self, dm):
        """create_character returns a dict with all expected keys."""
        c = dm.create_character("Hero")
        for key in ("id", "name", "image", "dna", "tags", "created", "modified"):
            assert key in c
        assert c["name"] == "Hero"
        assert c["image"] is None
        assert c["dna"] == ""
        assert c["tags"] == []
        assert isinstance(c["created"], float)
        assert isinstance(c["modified"], float)

    def test_create_character_unique_ids(self, dm):
        """Each call to create_character generates a unique UUID."""
        ids = {dm.create_character("A")["id"] for _ in range(10)}
        assert len(ids) == 10


# ---------------------------------------------------------------------------
# Utils tests
# ---------------------------------------------------------------------------

class TestHomogenizeDna:
    """Tests for the homogenize_dna utility."""

    def test_basic_homogenisation(self):
        """The second gene value is replaced by the first."""
        result = homogenize_dna('gene_name = { "val1" 10 "val2" 20 }')
        assert 'gene_name = { "val1" 10 "val1" 10 }' in result

    def test_numeric_values(self):
        """Numeric gene values are also homogenised."""
        result = homogenize_dna("gene = { 5 10 7 10 }")
        assert "gene = { 5 10 5 10 }" in result

    def test_preserves_non_matching_lines(self):
        """Lines that don't match the gene pattern are left unchanged."""
        text = """header = {
gene = { "a" 1 "b" 1 }
comment
}"""
        result = homogenize_dna(text)
        assert "header" in result
        assert "comment" in result
        assert 'gene = { "a" 1 "a" 1 }' in result

    def test_empty_input(self):
        """Empty input returns empty string."""
        assert homogenize_dna("") == ""

    def test_no_genes(self):
        """Text with no gene lines is returned unchanged."""
        text = "just some text\nno genes here\n"
        assert homogenize_dna(text) == text

    def test_multiple_genes(self):
        """Multiple gene lines are all homogenised."""
        text = """gene1 = { "x" 5 "y" 5 }
gene2 = { 1 2 3 2 }"""
        result = homogenize_dna(text)
        assert 'gene1 = { "x" 5 "x" 5 }' in result
        assert "gene2 = { 1 2 1 2 }" in result

    def test_preserves_indentation(self):
        """Leading whitespace is preserved."""
        text = "    gene = { 10 20 30 20 }"
        result = homogenize_dna(text)
        assert result == "    gene = { 10 20 10 20 }"

    def test_already_homogenised(self):
        """An already homogenised gene line is unchanged."""
        text = 'gene = { "val" 3 "val" 3 }'
        assert homogenize_dna(text).strip() == text.strip()

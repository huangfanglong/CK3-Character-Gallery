"""Unit tests for the CK3 Character Gallery.

Run with: python -m pytest tests/ -v
"""

import json
import os

import pytest

from data_manager import DataManager
from utils import homogenize_dna

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

    def test_corrupt_json_falls_back_to_default(self, tmp_path):
        """A corrupt JSON file is backed up and a fresh gallery is loaded."""
        data_dir = tmp_path / "test_corrupt"
        data_dir.mkdir()
        corrupt_file = data_dir / "galleries.json"
        corrupt_file.write_text("this is not valid json {{{", encoding="utf-8")

        dm = DataManager(data_dir=str(data_dir))
        assert len(dm.galleries) == 1
        assert dm.galleries[0]["name"] == "Default"
        assert os.path.exists(str(corrupt_file) + ".backup")

    @pytest.mark.parametrize(
        "data",
        [
            {},
            [],
            [{"name": "Broken"}],
            [{"name": "Broken", "characters": [{"id": "c1"}]}],
            [{"name": "Broken", "characters": [{"id": "..", "name": "Bad"}]}],
        ],
    )
    def test_malformed_json_schema_falls_back_to_default(self, tmp_path, data):
        """Valid JSON with an unsafe schema is backed up instead of crashing startup."""
        data_dir = tmp_path / "test_malformed"
        data_dir.mkdir()
        data_file = data_dir / "galleries.json"
        data_file.write_text(json.dumps(data), encoding="utf-8")

        dm = DataManager(data_dir=str(data_dir))

        assert dm.galleries == [{"name": "Default", "characters": []}]
        assert os.path.exists(str(data_file) + ".backup")

    def test_missing_json_file_creates_default(self, tmp_path):
        """When no JSON file exists, a default gallery is created."""
        data_dir = tmp_path / "test_empty"
        data_dir.mkdir()

        dm = DataManager(data_dir=str(data_dir))
        assert len(dm.galleries) == 1
        assert dm.galleries[0]["name"] == "Default"

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

    def test_portrait_count_zero(self, dm):
        """portrait_count returns 0 for a character with no portraits."""
        c = dm.create_character("Test")
        assert dm.portrait_count(c) == 0

    def test_add_portrait(self, dm):
        """add_portrait copies a file into the character's portrait directory."""
        src_dir = os.path.join(dm.data_dir, "temp_src")
        os.makedirs(src_dir, exist_ok=True)
        src = os.path.join(src_dir, "test.png")
        with open(src, "wb") as f:
            f.write(b"fake-png-data")

        dest = dm.add_portrait("char-1", src)
        assert os.path.exists(dest)
        assert "char-1" in dest
        assert dest.endswith("0.png")
        assert dest.startswith(os.path.join(dm.data_dir, "images"))

    def test_delete_character_images(self, dm):
        """delete_character_images removes the entire portrait directory."""
        img_dir = dm._portrait_dir("char-1")
        os.makedirs(img_dir, exist_ok=True)
        path = os.path.join(img_dir, "0.png")
        with open(path, "wb") as f:
            f.write(b"data")
        assert os.path.exists(path)
        dm.delete_character_images("char-1")
        assert not os.path.exists(img_dir)

    def test_delete_character_images_no_dir(self, dm):
        """delete_character_images handles missing directory gracefully."""
        dm.delete_character_images("nonexistent")

    def test_delete_gallery_images(self, dm):
        """delete_gallery_images removes all character portrait dirs."""
        for cid in ("c1", "c2"):
            d = dm._portrait_dir(cid)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "0.png"), "wb") as f:
                f.write(b"x")

        gallery = {
            "name": "Test",
            "characters": [
                {"id": "c1", "images": [os.path.join(dm._portrait_dir("c1"), "0.png")]},
                {"id": "c2", "images": [os.path.join(dm._portrait_dir("c2"), "0.png")]},
            ],
        }
        dm.delete_gallery_images(gallery)
        assert not os.path.isdir(dm._portrait_dir("c1"))
        assert not os.path.isdir(dm._portrait_dir("c2"))

    def test_export_gallery(self, dm):
        """export_gallery creates a folder with JSON and images."""
        char_dir = dm._portrait_dir("char1")
        os.makedirs(char_dir, exist_ok=True)
        img_path = os.path.join(char_dir, "0.png")
        with open(img_path, "wb") as f:
            f.write(b"png-data")

        gallery = {
            "name": "ExportTest",
            "characters": [
                {"id": "char1", "name": "Foo", "images": [img_path], "dna": "", "tags": []}
            ],
        }
        export_parent = os.path.join(dm.data_dir, "exports")
        os.makedirs(export_parent, exist_ok=True)

        out = dm.export_gallery(gallery, export_parent)
        expected = os.path.join(export_parent, "ExportTest")
        assert out == expected
        assert os.path.exists(os.path.join(expected, "characters.json"))
        assert os.path.exists(os.path.join(expected, "images", "char1", "0.png"))

    @pytest.mark.parametrize(
        "name", ["..", "../outside", "..\\outside", "/absolute/outside"]
    )
    def test_export_gallery_rejects_unsafe_name(self, dm, tmp_path, name):
        """A gallery name cannot escape or overwrite outside the export directory."""
        export_parent = tmp_path / "exports"
        export_parent.mkdir()
        outside = tmp_path / "outside"
        outside.mkdir()
        marker = outside / "keep.txt"
        marker.write_text("keep", encoding="utf-8")

        with pytest.raises(ValueError, match="unsafe|path component"):
            dm.export_gallery({"name": name, "characters": []}, str(export_parent))

        assert marker.read_text(encoding="utf-8") == "keep"

    def test_import_gallery(self, dm):
        """import_gallery reads a folder and appends a new gallery."""
        src_dir = os.path.join(dm.data_dir, "import_src")
        os.makedirs(os.path.join(src_dir, "images", "xyz"), exist_ok=True)
        char_data = [
            {"id": "xyz", "name": "Alice", "dna": "gene=1", "tags": ["elf"],
             "images": ["images/xyz/0.png"]}
        ]
        with open(os.path.join(src_dir, "characters.json"), "w") as f:
            json.dump(char_data, f)
        img_path = os.path.join(src_dir, "images", "xyz", "0.png")
        with open(img_path, "wb") as f:
            f.write(b"png-data")

        dm.import_gallery(src_dir, "Imported")
        assert len(dm.galleries) == 2
        imported = dm.galleries[1]
        assert imported["name"] == "Imported"
        assert len(imported["characters"]) == 1
        assert imported["characters"][0]["name"] == "Alice"
        assert len(imported["characters"][0]["images"]) == 1

    def test_import_gallery_old_format(self, dm):
        """import_gallery handles legacy flat image format."""
        src_dir = os.path.join(dm.data_dir, "import_old")
        os.makedirs(os.path.join(src_dir, "images"), exist_ok=True)
        char_data = [
            {"id": "old1", "name": "Legacy", "dna": "x", "tags": [], "image": "dummy"}
        ]
        with open(os.path.join(src_dir, "characters.json"), "w") as f:
            json.dump(char_data, f)
        img_path = os.path.join(src_dir, "images", "old1.png")
        with open(img_path, "wb") as f:
            f.write(b"png-data")

        dm.import_gallery(src_dir, "Legacy Gallery")
        g = dm.find_gallery("Legacy Gallery")
        assert g is not None
        assert len(g["characters"][0]["images"]) == 1
        # Clean up
        dm.galleries.remove(g)

    @pytest.mark.parametrize(
        "characters",
        [
            {},
            [{"id": "c1"}],
            [{"id": "..", "name": "Escape", "images": ["0.png"]}],
            [{"id": "/outside", "name": "Absolute", "images": ["0.png"]}],
            [{"id": "c1", "name": "Bad images", "images": "0.png"}],
        ],
    )
    def test_import_gallery_rejects_malformed_or_unsafe_data(
        self, dm, tmp_path, characters
    ):
        """Malformed imports are rejected before a gallery is appended."""
        src_dir = tmp_path / "unsafe_import"
        src_dir.mkdir()
        (src_dir / "characters.json").write_text(
            json.dumps(characters), encoding="utf-8"
        )
        before = len(dm.galleries)

        with pytest.raises(ValueError):
            dm.import_gallery(str(src_dir), "Unsafe")

        assert len(dm.galleries) == before

    def test_create_character_has_required_fields(self, dm):
        """create_character returns a dict with all expected keys."""
        c = dm.create_character("Hero")
        for key in ("id", "name", "images", "dna", "tags", "created", "modified"):
            assert key in c
            assert key in c
        assert c["name"] == "Hero"
        assert c["images"] == []
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

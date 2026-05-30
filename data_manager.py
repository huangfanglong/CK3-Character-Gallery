"""Data persistence layer for CK3 Character Gallery.

Handles loading, saving, importing, and exporting gallery data to/from JSON files,
as well as managing character portrait images on disk.
"""

import json
import os
import shutil
import time
import uuid
from typing import Any

CharacterDict = dict[str, Any]
GalleryDict = dict[str, Any]
GalleriesList = list[GalleryDict]


class DataManager:
    """Manages gallery data persistence and image file storage."""

    def __init__(self, data_dir: str = "character_gallery_data") -> None:
        """Initialise the data manager, loading existing data or creating defaults.

        Args:
            data_dir: Path to the directory where gallery data and images are stored.
        """
        self.data_dir: str = data_dir
        self.data_file: str = os.path.join(data_dir, "galleries.json")
        self.galleries: GalleriesList = []
        os.makedirs(data_dir, exist_ok=True)
        self._load()

    def _load(self) -> None:
        """Load galleries from the JSON data file, or initialise with a default gallery.

        If the data file exists but is corrupt (invalid JSON), the file is backed up
        and a fresh default gallery is created so the application can still start.
        """
        if not os.path.exists(self.data_file):
            self.galleries = [{"name": "Default", "characters": []}]
            return

        try:
            with open(self.data_file, encoding="utf-8") as f:
                self.galleries = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            backup = self.data_file + ".backup"
            try:
                os.replace(self.data_file, backup)
            except OSError:
                pass
            self.galleries = [{"name": "Default", "characters": []}]
            print(
                f"Warning: Could not load {self.data_file}: {exc}. "
                f"Original backed up to {backup}. Starting with a fresh gallery.",
                flush=True,
            )

        self._migrate()

    def _migrate(self) -> None:
        """Convert legacy single-image characters to the multi-portrait format."""
        for gallery in self.galleries:
            for char in gallery.get("characters", []):
                if "images" in char:
                    continue
                old = char.get("image")
                char.pop("image", None)
                new_dir = self._portrait_dir(char["id"])
                new_path = os.path.join(new_dir, "0.png")

                if old and os.path.isfile(old):
                    os.makedirs(new_dir, exist_ok=True)
                    if not os.path.exists(new_path):
                        shutil.move(old, new_path)
                    char["images"] = [new_path]
                elif os.path.isfile(new_path):
                    char["images"] = [new_path]
                else:
                    char["images"] = []

    def save(self) -> None:
        """Persist the galleries list to the JSON data file on disk.

        Writes to a temporary file first, then atomically replaces the
        real file so a crash during save never leaves corrupt data.
        """
        tmp = self.data_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.galleries, f, indent=2)
        os.replace(tmp, self.data_file)

    def find_gallery(self, name: str) -> GalleryDict | None:
        """Find a gallery by its name.

        Args:
            name: The name of the gallery to locate.

        Returns:
            The gallery dictionary if found, otherwise None.
        """
        for g in self.galleries:
            if g["name"] == name:
                return g
        return None

    def get_gallery_names(self) -> list[str]:
        """Return a list of all gallery names."""
        return [g["name"] for g in self.galleries]

    def get_gallery_choices(self) -> list[str]:
        """Return gallery names plus the 'Create new' option for use in a combobox."""
        return self.get_gallery_names() + ["Create a new gallery..."]

    def _portrait_dir(self, char_id: str) -> str:
        """Return the directory where a character's portrait images are stored."""
        return os.path.join(self.data_dir, "images", char_id)

    def portrait_count(self, char: CharacterDict) -> int:
        """Return the number of portraits for a character."""
        return len(char.get("images", []))

    def add_portrait(self, char_id: str, src_path: str) -> str:
        """Copy an image into the character's portrait directory.

        The image is stored as the next sequential index (e.g. 2.png).

        Args:
            char_id: UUID of the character.
            src_path: Path to the source image file.

        Returns:
            The destination path of the saved portrait.
        """
        dest_dir = self._portrait_dir(char_id)
        os.makedirs(dest_dir, exist_ok=True)
        idx = len(os.listdir(dest_dir))
        dest = os.path.join(dest_dir, f"{idx}.png")
        shutil.copy2(src_path, dest)
        return dest

    def delete_character_images(self, char_id: str) -> None:
        """Delete all portrait images for a character."""
        d = self._portrait_dir(char_id)
        if os.path.isdir(d):
            shutil.rmtree(d)

    def delete_gallery_images(self, gallery: GalleryDict) -> None:
        """Delete all image files associated with a gallery's characters.

        Args:
            gallery: The gallery dictionary whose character images should be deleted.
        """
        for char in gallery.get("characters", []):
            self.delete_character_images(char["id"])

    def export_gallery(self, gallery: GalleryDict, dest_dir: str) -> str:
        """Export a gallery to a folder on disk.

        Creates a subfolder named after the gallery inside *dest_dir*,
        containing a ``characters.json`` file and an ``images/`` subdirectory.

        Args:
            gallery: The gallery dictionary to export.
            dest_dir: The parent directory in which to create the export folder.

        Returns:
            The path to the created export directory.
        """
        name = gallery["name"]
        out_dir = os.path.join(dest_dir, name)
        if os.path.exists(out_dir):
            shutil.rmtree(out_dir)
        os.makedirs(out_dir, exist_ok=True)

        with open(os.path.join(out_dir, "characters.json"), "w", encoding="utf-8") as f:
            json.dump(gallery["characters"], f, indent=2)

        images_out = os.path.join(out_dir, "images")
        os.makedirs(images_out, exist_ok=True)
        for char in gallery.get("characters", []):
            for img in char.get("images", []):
                if img and os.path.exists(img):
                    char_out = os.path.join(images_out, char["id"])
                    os.makedirs(char_out, exist_ok=True)
                    shutil.copy2(img, os.path.join(char_out, os.path.basename(img)))

        return out_dir

    def import_gallery(self, folder: str, gallery_name: str) -> GalleryDict:
        """Import a gallery from a folder on disk.

        The folder must contain a ``characters.json`` file. Images are copied
        into the data storage directory.

        Args:
            folder: Path to the folder containing the exported gallery data.
            gallery_name: The name to assign to the imported gallery.

        Returns:
            The newly created gallery dictionary.
        """
        json_file = os.path.join(folder, "characters.json")
        images_folder = os.path.join(folder, "images")

        with open(json_file, encoding="utf-8") as f:
            chars: list[dict[str, Any]] = json.load(f)

        new_gallery: GalleryDict = {"name": gallery_name, "characters": []}
        for char in chars:
            cid = str(uuid.uuid4())
            old_id = char.get("id", cid)

            # Gather source images (support both old "image" and new "images")
            old_image = char.get("image")
            old_images = char.get("images")
            if old_images:
                src_paths = [os.path.join(images_folder, old_id, os.path.basename(p))
                             for p in old_images]
            elif old_image:
                src_paths = [os.path.join(images_folder, f"{old_id}.png")]
            else:
                src_paths = []

            new_images: list[str] = []
            dest_dir = self._portrait_dir(cid)
            os.makedirs(dest_dir, exist_ok=True)
            for i, src in enumerate(src_paths):
                if os.path.exists(src):
                    dest = os.path.join(dest_dir, f"{i}.png")
                    shutil.copy2(src, dest)
                    new_images.append(dest)

            char["id"] = cid
            char["images"] = new_images
            char.pop("image", None)
            new_gallery["characters"].append(char)

        self.galleries.append(new_gallery)
        return new_gallery

    @staticmethod
    def create_character(name: str) -> CharacterDict:
        """Create a new character dictionary with sensible defaults.

        Args:
            name: The display name for the new character.

        Returns:
            A character dictionary with a fresh UUID, empty DNA/tags, and current timestamps.
        """
        now = time.time()
        return {
            "id": str(uuid.uuid4()),
            "name": name,
            "images": [],
            "dna": "",
            "tags": [],
            "created": now,
            "modified": now,
        }

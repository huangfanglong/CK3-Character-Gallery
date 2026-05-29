"""Data persistence layer for CK3 Character Gallery.

Handles loading, saving, importing, and exporting gallery data to/from JSON files,
as well as managing character portrait images on disk.
"""

import json
import os
import shutil
import uuid
import time
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
        """Load galleries from the JSON data file, or initialise with a default gallery."""
        if os.path.exists(self.data_file):
            with open(self.data_file, "r", encoding="utf-8") as f:
                self.galleries = json.load(f)
        else:
            self.galleries = [{"name": "Default", "characters": []}]

    def save(self) -> None:
        """Persist the galleries list to the JSON data file on disk."""
        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(self.galleries, f, indent=2)

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

    def get_image_path(self, char_id: str) -> str:
        """Return the expected image file path for a given character ID.

        Args:
            char_id: The UUID string of the character.

        Returns:
            Full path to where the character's portrait image should be stored.
        """
        return os.path.join(self.data_dir, "images", f"{char_id}.png")

    def copy_image_to_storage(self, src_path: str, char_id: str) -> str:
        """Copy an image file into the data storage directory.

        Args:
            src_path: Path to the source image file.
            char_id: UUID of the character to associate the image with.

        Returns:
            The destination path of the copied image.
        """
        dest_path = self.get_image_path(char_id)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        shutil.copy2(src_path, dest_path)
        return dest_path

    def delete_image(self, image_path: str | None) -> None:
        """Delete an image file from disk if it exists.

        Args:
            image_path: Path to the image file to delete, or None.
        """
        if image_path and os.path.exists(image_path):
            os.remove(image_path)

    def delete_gallery_images(self, gallery: GalleryDict) -> None:
        """Delete all image files associated with a gallery's characters.

        Args:
            gallery: The gallery dictionary whose character images should be deleted.
        """
        for char in gallery.get("characters", []):
            self.delete_image(char.get("image"))

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
            img = char.get("image")
            if img and os.path.exists(img):
                shutil.copy2(img, os.path.join(images_out, os.path.basename(img)))

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

        with open(json_file, "r", encoding="utf-8") as f:
            chars: list[dict[str, Any]] = json.load(f)

        new_gallery: GalleryDict = {"name": gallery_name, "characters": []}
        for char in chars:
            cid = char.get("id", str(uuid.uuid4()))
            char["id"] = cid
            src_img = os.path.join(images_folder, f"{cid}.png")
            if os.path.exists(src_img):
                char["image"] = self.copy_image_to_storage(src_img, cid)
            else:
                char["image"] = None
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
            "image": None,
            "dna": "",
            "tags": [],
            "created": now,
            "modified": now,
        }

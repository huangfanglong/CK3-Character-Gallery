"""CK3 Character Gallery - Application entry point.

Launch the main application window.
"""

from gallery_ui import CharacterGallery


def main() -> None:
    """Entry point: create and run the CK3 Character Gallery application."""
    app = CharacterGallery()
    app.mainloop()


if __name__ == "__main__":
    main()

# CK3 Character Gallery

[![Build](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/compile.yml/badge.svg)](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/compile.yml)
[![Tests](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/tests.yml/badge.svg)](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/tests.yml)

A desktop application for managing and organizing Crusader Kings 3 character DNAs.

![alt text](https://i.imgur.com/PuKypMQ.png)

## Features

- **Multiple Galleries**: Create, rename, and delete gallery sets (e.g., Male, Female) to organize characters or categorize them. Import & Export them to save online or share them with others.
- **Character Management**: Add, delete, and batch-delete character entries within each gallery. Give each character entry specific tags and ability to search & narrow them in the search box.
- **Portrait Cropping**: Adjust portrait images display with drag and scroll-to-zoom.
- **Multi-Portrait Support**: Each character can have up to 5 portraits. Add slots with the `+` button, remove with `-`, and cycle through them with on-canvas arrow overlays.
- **DNA Displayer**:
  - View and edit raw character DNA strings.
  - Clear, homogenize (gene-value duplication), save, and copy DNA with one click.
- **Hotkeys**:
  - Ctrl+S: Save current character data.
  - Ctrl+Z: Undo DNA edits.
  - Ctrl+N: New Character entry.
  - Ctrl+D: Duplicate character entry.
  - Ctrl+E: Exports current gallery.
  - Ctrl+F: Search.
  - Ctrl+V: Paste portrait image from clipboard into current slot.
  - Delete: Remove selected characters.
  - F2: Renames selected character.

## Installation

1. **Requirements**:
   - Python 3.10+
   - Tkinter (bundled with most Python installs)
   - Pillow (see `requirements.txt`)

2. **Clone the repository**:
   ```bash
   git clone https://github.com/huangfanglong/CK3-Character-Gallery.git
   cd CK3-Character-Gallery
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**:
   ```bash
   python main.py
   ```

## Or Build Executable (Optional)
   To create a standalone `.exe` file:
   ```bash
   pyinstaller --onefile --noconsole main.py
   ```

   To create a standalone `.exe` file with a custom icon (OPTIONAL):
   ```bash
   pyinstaller --onefile --noconsole --icon app.ico --add-data "app.png;." main.py
   ```
   Place `app.ico` (small, for the .exe file icon) and `app.png` (higher
   resolution, for the taskbar) in the project root.

   And then run the .exe

## Usage

1. Ctrl+N to create new character entry (or click the +New button).
2. Click 'Change Portrait', or click directly in the Portrait box, or Copy (Ctrl+C) a picture of the character (I usually Ctrl+C directly from Snipping Tool after taking a snip in-game) and then Ctrl+V with that character entry selected. This replaces the image in the currently-selected portrait slot. Use the **+** and **-** buttons to add or remove portrait slots (up to 5 per character), and the on-canvas arrows or left/right edges of the portrait to cycle between them.
3. Then it prompts a window to reposition the image to choose what portion of the image to display in the Portrait window (use mouse scroll to adjust zoom if you'd like to display a wider or narrower area of the image in the Portrait window).
4. And then just Copy the DNA and paste it inside the Character DNA box.
5. Save (Ctrl + S).
6. **To use Tags** & narrow character entry list to specific tags, start with "tags:" or "tag:" in the search box followed by the tag, separate by comma if multiple.
![alt text](https://i.imgur.com/7FjG0IL.png)

## Data Storage

- Galleries and character metadata are stored in `character_gallery_data/galleries.json`.
- Portrait images are saved under `character_gallery_data/images/<character_id>/0.png`, `1.png`, etc.

## Contributing

Bug reports and pull requests are welcome. Please follow standard GitHub contribution workflows.

## License

This project is licensed under the MIT License.

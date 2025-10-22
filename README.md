# CK3 Character Gallery

A desktop application for managing and organizing Crusader Kings 3 character DNAs.

## Features

- **Multiple Galleries**: Create, rename, and delete gallery sets (e.g., Male, Female) to organize characters or categorize them. Import & Export them to save online or share them with others.
- **Character Management**: Add, delete, and batch-delete character entries within each gallery.
- **Portrait Cropping**: Adjust portrait images display with drag and scroll-to-zoom.
- **DNA Displayer**:
  - View and edit raw character DNA strings.
  - Clear, homogenize (gene-value duplication), save, and copy DNA with one click.
- **Hotkeys**:
  - Ctrl+S: Save current character data.
  - Ctrl+Z: Undo DNA edits.
  - Delete: Remove selected characters.

## Installation

1. **Requirements**:
   - Python 3.10+
   - Tkinter (should be bundled with most Python installs)
   - Pillow (`pip install pillow`)

2. **Clone the repository**:
   ```bash
   git clone https://github.com/huangfanglong/CK3-Character-Gallery.git
   cd ck3-character-gallery
   ```

3. **Run the application**:
   ```bash
   python ck3_character_gallery.py
   ```

## Usage

1. **Gallery Selection**: Supports multiple galleries for better organizations and convenience (e.g: one gallery for male, one for female). Use the dropdown at top-left to switch between galleries/sets or create a new one.
2. **Search**: Type in the search box to filter character names instantly.
3. **Adding Characters entries**: Click **+ New**, enter a name, then optionally add a portrait.
4. **Deleting Characters entries**: Supports hotkey **Delete** on keyboard and multi-select (holding down Ctrl + Click or Ctrl + Shift) for batch deletion.
5. **Portrait Display**:
   - Each character entry in each gallery has its own portrait display and its corresponding DNA box.
   - Click **Change Portrait** or directly on Portrait window to add the display image for the character. Alternatively (and perhaps more conveniently), you can also copy images directly from File Explorer or the Snipping Tool with Ctrl+C and select a character entry then Ctrl+V (Paste) it.
   - Drag to reposition and scroll to zoom to select the area of portrait to display for each character entry (currently support 450x450).
   - Click **OK** to save the cropped portrait.
6. **DNA Display**:
   - Some QoL buttons such as: **Clear**, **Homogenize DNA**, **Save Changes**, or **Copy DNA**.
7. **Gallery Management**: Click the **...** menu next to the gallery dropdown to rename or delete the current gallery, also support exporting & importing galleries. Sorting is also supported.

## Data Storage

- Galleries and character metadata are stored in `character_gallery_data/galleries.json`.
- Portrait images are saved under `character_gallery_data/images/<character_id>.png`.

## Contributing

Bug reports and pull requests are welcome. Please follow standard GitHub contribution workflows.

## License

This project is licensed under the MIT License.

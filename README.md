# CK3 Character Gallery

A desktop application for managing and organizing Crusader Kings 3 character DNAs.

![alt text](https://i.imgur.com/B1tV1Yq.png)

## Features

- **Multiple Galleries**: Create, rename, and delete gallery sets (e.g., Male, Female) to organize characters or categorize them. Import & Export them to save online or share them with others.
- **Character Management**: Add, delete, and batch-delete character entries within each gallery. Give each character entry specific tags and ability to search & narrow them in the search box.
- **Portrait Cropping**: Adjust portrait images display with drag and scroll-to-zoom.
- **DNA Displayer**:
  - View and edit raw character DNA strings.
  - Clear, homogenize (gene-value duplication), save, and copy DNA with one click.
- **Hotkeys**:
  - Ctrl+S: Save current character data.
  - Ctrl+Z: Undo DNA edits.
  - Ctrl+N: New Character entry
  - Ctrl+D: Duplicate character entry
  - Ctrl+E: Exports current gallery
  - Ctrl+F: Search
  - Delete: Remove selected characters.
  - F2: Renames selected character

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

## Or Build Executable (Optional)
   To create a standalone `.exe` file:
   ```bash
   pyinstaller --onefile --noconsole ck3_character_gallery.py
   ```
   And then run the .exe

## Usage

1. Ctrl+N to create new character entry (or click the +New button).
2. Click 'Change Portrait', or click directly in the Portrait box, or Copy (Ctrl+C) a picture of the character (I usually Ctrl+C directly from Snipping Tool after taking a snip in-game) and then Ctrl+V with that character entry selected.
3. Then it prompts a window to reposition the image to choose what portion of the image to display in the Portrait window (use mouse scroll to adjust zoom if you'd like to display a wider or narrower area of the image in the Portrait window).
4. And then just Copy the DNA and paste it inside the Character DNA box.
5. Save (Ctrl + S).
6. **To use Tags** & narrow character entry list to specific tags, start with "tags:" or "tag:" in the search box followed by the tag, separate by comma if multiple.

## Data Storage

- Galleries and character metadata are stored in `character_gallery_data/galleries.json`.
- Portrait images are saved under `character_gallery_data/images/<character_id>.png`.

## Contributing

Bug reports and pull requests are welcome. Please follow standard GitHub contribution workflows.

## License

This project is licensed under the MIT License.

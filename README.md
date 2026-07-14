# CK3 Character Gallery

[![Electron CI](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/ci.yml/badge.svg)](https://github.com/huangfanglong/CK3-Character-Gallery/actions/workflows/ci.yml)

![alt text](https://i.imgur.com/cBCOjk8.png)

CK3 Character Gallery is a local desktop archive for Crusader Kings III character DNA and portraits. I use it to keep faces, DNA strings, tags, and reference notes together instead of digging through screenshots and text files later.

Version 3 is currently an Electron alpha with a portrait-first archive. The v2 Python/Tkinter application is preserved on the `archive/v2` branch.

## Run v3

You need Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

`npm run dev` opens the Electron app from the repository. Build a Windows portable executable with `npm run package:win`; output is written to `release/`.

## Basic Usage

1. Create a character with `Ctrl+N` or click the `+ New character` button.
2. Select the character card, then add a portrait from a file or paste one with `Ctrl+V`.
3. Reposition and zoom a pasted image in the crop window. The saved portrait is a 450 x 450 PNG.
4. Select the character card or open the DNA workbench, then paste the raw CK3 DNA, and save it.
5. Add a title for the character card if you wish (maybe adding some title customization options soon).
6. Just play around with it.

A character can hold up to five portraits. Selecting a thumbnail in the inspector changes the large preview. The arrows on a character card choose which portrait appears as its cover, and that choice is saved with the record.

Favorites are stored in the Electron profile on the current computer. They are not part of `galleries.json` or exported collection manifests.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | Create a character |
| `Ctrl+F` | Focus search |
| `Ctrl+S` | Save the archive |
| `Ctrl+D` | Duplicate the selected character |
| `Ctrl+E` | Export the current collection |
| `Ctrl+V` | Paste a portrait, create a character from an image, or open copied DNA |
| `Ctrl+C` | Copy DNA from the selected character |
| `Ctrl+Z` | Undo the last DNA workbench edit |
| `Ctrl+Y` | Redo the last undone DNA workbench edit |
| `F2` | Open record management for the selected character |
| `Delete` | Delete the focused variant, selected character, or current batch |
| `Enter` | Confirm a delete dialog |
| `Escape` | Close the active dialog or menu, or leave batch selection |

On macOS, the command shortcuts also respond to `Command` though I don't have a Mac to test with.

## Local Data

Currently, similar to v2, v3 reads and writes the local archive at:

```text
character_gallery_data/
  galleries.json
  images/
    <character_id>/
      <portrait files>
```

Writes to `galleries.json` use a temporary file followed by a rename. A collection's `sortMode` stores its selected sort, while the character array stores its custom card order. Portrait deletion is restricted to the archive's `images` directory.

A packaged Electron build uses `character_gallery_data` under Electron's application data directory instead of the repository. Use Import collection to bring an exported archive into the packaged app.

See [CHANGELOG.md](CHANGELOG.md) for the v3 change history.

## Checks

Run the JavaScript syntax checks:

```bash
npm run test:smoke
```

Run the Electron renderer smoke test:

```bash
node scripts/smoke-renderer.cjs
```

Run the isolated collection round-trip test:

```bash
npm run test:transfer
```

Run all Node checks:

```bash
npm test
```

The renderer smoke test opens Electron and checks the archive, combinable filters, Ctrl-click selection, list portrait previews, custom card ordering, portrait variants, deletion focus, inspector, notes, menus, shortcuts, search, and viewport sizing. It creates temporary renderer-only character cards/records, so it does not rewrite the development archive.

## Contributing

Bug reports and pull requests are welcome. For v3 changes, include the renderer smoke test when the behavior can be exercised through the UI. Prefer to include a test for everything to prevent regression.

## License

MIT

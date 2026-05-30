"""Main application window for the CK3 Character Gallery.

Provides the three-panel UI for managing character galleries, viewing/editing
portraits, DNA data, and tags.
"""

import json
import os
import sys
import time
import tkinter as tk
import uuid
from tkinter import filedialog, ttk
from typing import Any

import sv_ttk
from PIL import Image, ImageGrab, ImageTk

import dialogs
from data_manager import DataManager
from image_cropper import ImageCropper
from utils import homogenize_dna


class CharacterGallery(tk.Tk):
    """Main application window for browsing and editing CK3 character data."""

    def __init__(self, data_manager: DataManager | None = None) -> None:
        """Initialise the main window, data manager, UI, and hotkey bindings.

        Args:
            data_manager: Optional pre-configured DataManager instance.
                          If not provided, a default one is created.
        """
        super().__init__()
        self.title("CK3 Character Gallery")
        self.geometry("1600x900")
        self.configure(bg="#1c1c1c")
        self._set_app_icon()

        self.data_manager = data_manager or DataManager()

        self.current_gallery: dict[str, Any] | None = None
        self.current_index: int | None = None
        self.current_portrait_index: int = 0
        self.dirty: bool = False
        self._drag_idx: int | None = None
        self._char_indices: list[int] = []

        self.protocol("WM_DELETE_WINDOW", self.on_close)

        self.setup_ui()

        self.gallery_var.set(self.data_manager.galleries[0]["name"])
        self.load_gallery(self.data_manager.galleries[0]["name"])

        self._bind_hotkeys()

        self._geometry_file = os.path.join(
            self.data_manager.data_dir, "window.json"
        )
        self._restore_geometry()

        self.status_label = tk.Label(
            self,
            text="Idle",
            bg="#1c1c1c",
            fg="#888888",
            font=("TkDefaultFont", 8),
        )
        self.status_label.pack(side="bottom", fill="x", padx=5, pady=1)

    # ------------------------------------------------------------------
    # Hotkey bindings
    # ------------------------------------------------------------------

    def _bind_hotkeys(self) -> None:
        """Register application-wide hotkeys."""
        self.bind_all("<Control-s>", lambda e: self.save_current())
        self.bind_all("<Control-S>", lambda e: self.save_current())
        self.dna_text.config(undo=True, autoseparators=True, maxundo=-1)
        self.dna_text.bind("<Control-z>", lambda e: self.dna_text.edit_undo())
        self.dna_text.bind("<Control-Z>", lambda e: self.dna_text.edit_undo())
        self.bind_all("<Control-v>", lambda e: self.paste_from_clipboard())
        self.bind_all("<Control-V>", lambda e: self.paste_from_clipboard())
        self.bind_all("<Control-n>", lambda e: self.new_character())
        self.bind_all("<Control-N>", lambda e: self.new_character())
        self.bind_all("<F2>", lambda e: self.rename_character())
        self.bind_all("<Control-e>", lambda e: self.export_gallery())
        self.bind_all("<Control-E>", lambda e: self.export_gallery())
        self.bind_all("<Control-f>", lambda e: self.focus_search())
        self.bind_all("<Control-F>", lambda e: self.focus_search())
        self.bind_all("<Control-d>", lambda e: self.duplicate_character())
        self.bind_all("<Control-D>", lambda e: self.duplicate_character())

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def setup_ui(self) -> None:
        """Build the three-panel application layout."""
        sv_ttk.set_theme("dark")

        main_frame = tk.Frame(self, bg="#1c1c1c")
        main_frame.pack(fill="both", expand=True, padx=10, pady=10)

        self._build_left_panel(main_frame)
        self._build_middle_panel(main_frame)
        self._build_right_panel(main_frame)

    def _build_left_panel(self, parent: tk.Frame) -> None:
        """Build the gallery selector, search box, and character list."""
        list_frame = tk.Frame(parent, bg="#1c1c1c", width=250)
        list_frame.pack(side="left", fill="y", padx=(0, 10))
        list_frame.pack_propagate(False)

        top_frame = tk.Frame(list_frame, bg="#1c1c1c")
        top_frame.pack(fill="x", pady=(5, 2))

        self.gallery_var = tk.StringVar()
        self.gallery_box = ttk.Combobox(
            top_frame,
            textvariable=self.gallery_var,
            values=self.data_manager.get_gallery_choices(),
            state="readonly",
        )
        self.gallery_box.pack(side="left", fill="x", expand=True, padx=(5, 0))
        self.gallery_box.bind("<<ComboboxSelected>>", self.on_gallery_change)

        self.gallery_menu = tk.Menu(self, tearoff=False,
            bg="#2b2b2b", fg="#cccccc")
        self.gallery_menu.add_command(label="Rename Gallery", command=self.rename_gallery)
        self.gallery_menu.add_command(label="Delete Gallery", command=self.delete_gallery_confirm)
        self.gallery_menu.add_separator()
        self.gallery_menu.add_command(label="Export Gallery", command=self.export_gallery)
        self.gallery_menu.add_command(label="Import Gallery", command=self.import_gallery)
        self.gallery_menu.add_separator()
        sort_sub = tk.Menu(self.gallery_menu, tearoff=False,
            bg="#2b2b2b", fg="#cccccc")
        sort_sub.add_command(label="Name A→Z", command=lambda: self.sort_characters("name_asc"))
        sort_sub.add_command(label="Name Z→A", command=lambda: self.sort_characters("name_desc"))
        sort_sub.add_command(label="Created ↑", command=lambda: self.sort_characters("created_asc"))
        sort_sub.add_command(label="Created ↓", command=lambda: self.sort_characters("created_desc"))
        sort_sub.add_command(label="Modified ↓", command=lambda: self.sort_characters("modified_desc"))
        self.gallery_menu.add_cascade(label="Sort Characters", menu=sort_sub)
        self.gallery_menu.add_separator()
        self.gallery_menu.add_command(label="Keyboard Shortcuts", command=self._show_shortcuts)

        menu_btn = tk.Button(
            top_frame, text="\u2699", font=("Segoe UI", 12),
            bg="#1c1c1c", fg="#cccccc", bd=0, relief="flat",
            activebackground="#555555", activeforeground="#ffffff",
            command=lambda: self.gallery_menu.tk_popup(
                menu_btn.winfo_rootx(), menu_btn.winfo_rooty() + menu_btn.winfo_height()
            ),
        )
        menu_btn.bind("<Enter>", lambda e: menu_btn.config(bg="#3a3a3a"))
        menu_btn.bind("<Leave>", lambda e: menu_btn.config(bg="#1c1c1c"))
        menu_btn.pack(side="left", padx=2)

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(list_frame, textvariable=self.search_var)
        self._placeholder_text = "Search name or use tag:keyword..."
        self._placeholder_active = True
        self.search_entry.insert(0, self._placeholder_text)
        self.search_entry.config(foreground="#888888")
        self.search_entry.pack(fill="x", padx=5, pady=(0, 5))
        self.search_entry.bind("<FocusIn>", self._on_search_focus_in)
        self.search_entry.bind("<FocusOut>", self._on_search_focus_out)
        self.search_entry.bind("<KeyRelease>", lambda e: self.filter_list())

        list_container = tk.Frame(list_frame, bg="#1c1c1c")
        list_container.pack(fill="both", expand=True, padx=5)

        scrollbar = ttk.Scrollbar(list_container)
        scrollbar.pack(side="right", fill="y")

        self.char_listbox = tk.Listbox(
            list_container,
            bg="#1c1c1c",
            fg="#eeeeee",
            font=("Arial", 10),
            selectmode="extended",
            yscrollcommand=scrollbar.set,
            highlightthickness=0,
        )
        self.char_listbox.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self.char_listbox.yview)

        self.char_listbox.bind("<<ListboxSelect>>", self.on_select)
        self.char_listbox.bind("<Delete>", lambda e: self.delete_character())
        self.char_listbox.bind("<ButtonPress-1>", self.start_drag)
        self.char_listbox.bind("<ButtonRelease-1>", self.on_drop)

        self.char_menu = tk.Menu(self, tearoff=False,
            bg="#2b2b2b", fg="#cccccc")
        self.char_menu.add_command(label="Rename", command=self.rename_character)
        self.char_menu.add_command(label="Duplicate", command=self.duplicate_character)
        self.char_menu.add_command(label="Copy DNA", command=self.copy_dna)
        self.char_menu.add_separator()
        self.char_menu.add_command(label="Delete", command=self.delete_character)
        self.char_listbox.bind("<Button-3>", lambda e: self.show_char_menu(e))

        self.char_count_label = tk.Label(
            list_frame,
            text="",
            bg="#1c1c1c",
            fg="#888888",
            font=("TkDefaultFont", 8),
        )
        self.char_count_label.pack(fill="x", padx=5, pady=(2, 0))

        btn_frame = tk.Frame(list_frame, bg="#1c1c1c")
        btn_frame.pack(fill="x", pady=5, padx=5)
        ttk.Button(btn_frame, text="+ New", command=self.new_character, width=12).pack(
            side="left", padx=2
        )
        ttk.Button(btn_frame, text="Delete", command=self.delete_character, width=12).pack(
            side="right", padx=2
        )

    def _build_middle_panel(self, parent: tk.Frame) -> None:
        """Build the portrait display and tag editor."""
        portrait_frame = tk.Frame(parent, bg="#1c1c1c", width=525)
        portrait_frame.pack(side="left", fill="y", padx=10)
        portrait_frame.pack_propagate(False)

        ttk.Label(portrait_frame, text="Portrait", font=("Arial", 12, "bold")).pack(pady=5)

        self.portrait_canvas = tk.Canvas(
            portrait_frame,
            width=450,
            height=450,
            bg="#1c1c1c",
            highlightthickness=2,
            highlightbackground="#666666",
        )
        self.portrait_canvas.pack(pady=(0, 10))
        self.portrait_canvas.bind("<Button-1>", lambda e: self.change_portrait())

        self.portrait_image_id: int | None = None
        self.portrait_photo: ImageTk.PhotoImage | None = None
        self.portrait_arrow_left: int | None = None
        self.portrait_arrow_right: int | None = None
        self.portrait_counter_id: int | None = None

        self.portrait_canvas.bind("<Button-1>", self._on_portrait_click)

        portrait_btn_frame = ttk.Frame(portrait_frame)
        portrait_btn_frame.pack(pady=5)
        ttk.Button(portrait_btn_frame, text="-", width=3,
                   command=self._remove_portrait_slot).pack(side="left", padx=2)
        ttk.Button(portrait_btn_frame, text="Change", command=self.change_portrait).pack(side="left", padx=2)
        ttk.Button(portrait_btn_frame, text="+", width=3,
                   command=self._add_portrait_slot).pack(side="left", padx=2)

        ttk.Label(portrait_frame, text="Tags", font=("Arial", 12, "bold")).pack(pady=(20, 5))
        ttk.Label(
            portrait_frame,
            text="(separate by comma)",
            font=("Arial", 8),
            foreground="#888888",
        ).pack()
        self.tags_text = tk.Text(
            portrait_frame,
            wrap="word",
            bg="#1c1c1c",
            fg="#eeeeee",
            font=("Arial", 10),
            insertbackground="white",
            height=3,
            width=65,
        )
        self.tags_text.pack(padx=10, pady=5)
        self.tags_text.bind("<KeyRelease>", self.on_tags_change)

    def _build_right_panel(self, parent: tk.Frame) -> None:
        """Build the DNA text editor with action buttons."""
        dna_frame = tk.Frame(parent, bg="#1c1c1c", width=675)
        dna_frame.pack(side="right", fill="both", expand=True)

        ttk.Label(dna_frame, text="Character DNA", font=("Arial", 12, "bold")).pack(pady=5)

        text_container = tk.Frame(dna_frame, bg="#1c1c1c")
        text_container.pack(fill="both", expand=True)

        self.dna_text = tk.Text(
            text_container,
            wrap="none",
            bg="#1c1c1c",
            fg="#eeeeee",
            font=("Consolas", 10),
            insertbackground="white",
        )
        self.dna_text.pack(side="left", fill="both", expand=True)

        dna_scroll_y = ttk.Scrollbar(text_container, orient="vertical", command=self.dna_text.yview)
        dna_scroll_y.pack(side="right", fill="y")
        self.dna_text.config(yscrollcommand=dna_scroll_y.set)
        self.dna_text.bind("<KeyRelease>", self.on_dna_change)

        btns_frame = tk.Frame(dna_frame, bg="#1c1c1c")
        btns_frame.pack(fill="x", pady=5)
        ttk.Button(
            btns_frame,
            text="Clear DNA",
            command=lambda: self.dna_text.delete("1.0", tk.END),
            width=12,
        ).pack(side="left", padx=(0, 5))
        ttk.Button(
            btns_frame,
            text="Homogenize DNA",
            command=self.on_homogenize_dna,
            width=16,
        ).pack(side="left", padx=(0, 5))
        ttk.Button(
            btns_frame,
            text="Save Changes",
            command=self.save_current,
            width=12,
        ).pack(side="left", expand=True)
        ttk.Button(
            btns_frame,
            text="Copy DNA",
            command=self.copy_dna,
            width=12,
        ).pack(side="right", padx=(5, 0))

    # ------------------------------------------------------------------
    # Gallery combobox utilities
    # ------------------------------------------------------------------

    def _set_app_icon(self) -> None:
        """Set the window and taskbar icon from image files if available.

        Prefers a PNG via iconphoto() for the taskbar (higher resolution),
        falls back to an ICO via iconbitmap() for the title bar.
        """
        candidates = [
            ("app.png", True),
            (os.path.join("assets", "app.png"), True),
            ("app.ico", False),
            (os.path.join("assets", "app.ico"), False),
        ]
        base = getattr(sys, "_MEIPASS", None)
        if base:
            candidates.insert(0, (os.path.join(base, "app.png"), True))
        for path, use_photo in candidates:
            if os.path.isfile(path):
                if use_photo:
                    self.iconphoto(False, tk.PhotoImage(file=path))
                else:
                    self.iconbitmap(path)
                return

    def _update_gallery_combobox(self) -> None:
        """Refresh the gallery dropdown values from the data manager."""
        self.gallery_box["values"] = self.data_manager.get_gallery_choices()

    def _show_shortcuts(self) -> None:
        """Show a dialog listing all keyboard shortcuts."""
        dialogs.show_info(
            self, "Keyboard Shortcuts",
            "Ctrl+S     Save current character\n"
            "Ctrl+Z     Undo DNA edit\n"
            "Ctrl+N     New character entry\n"
            "Ctrl+D     Duplicate character\n"
            "Ctrl+E     Export current gallery\n"
            "Ctrl+F     Focus search box\n"
            "Ctrl+V     Paste portrait from clipboard\n"
            "Delete      Remove selected character(s)\n"
            "F2          Rename selected character",
        )

    def _char_idx(self, listbox_idx: int) -> int:
        """Convert a listbox display index to the actual character array index."""
        if 0 <= listbox_idx < len(self._char_indices):
            return self._char_indices[listbox_idx]
        return listbox_idx

    # ------------------------------------------------------------------
    # Status bar
    # ------------------------------------------------------------------

    def set_status(self, message: str) -> None:
        """Display a temporary status message in the status bar.

        The message is shown in green and automatically resets to 'Idle' after 5 seconds.

        Args:
            message: The message text to display.
        """
        self.status_label.config(text=message, fg="#00FF00")
        self.after(5000, lambda: self.status_label.config(text="Idle", fg="#888888"))

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def save_galleries(self) -> None:
        """Persist all galleries to disk and clear the dirty flag."""
        self.data_manager.save()
        self.dirty = False

    def save_current(self) -> None:
        """Save galleries and notify the user via status bar and dialog."""
        if self.current_index is not None:
            self.save_galleries()
            self.set_status("Character data saved successfully \u2714\ufe0f")
            dialogs.show_info(self, "Saved", "Character data saved successfully!")

    # ------------------------------------------------------------------
    # Gallery management
    # ------------------------------------------------------------------

    def on_gallery_change(self, event: tk.Event | None = None) -> None:
        """Handle gallery combobox selection, including 'Create new gallery'."""
        assert self.current_gallery is not None
        name = self.gallery_var.get()
        if name == "Create a new gallery...":
            new_name = dialogs.ask_string(
                self, "New Gallery", "Enter gallery name:"
            )
            if not new_name:
                self.gallery_var.set(self.current_gallery["name"])
                return
            if self.data_manager.find_gallery(new_name):
                dialogs.show_warning(
                    self, "Duplicate", f"A gallery named '{new_name}' already exists."
                )
                self.gallery_var.set(self.current_gallery["name"])
                return
            self.data_manager.galleries.append({"name": new_name, "characters": []})
            self.dirty = True
            self.save_galleries()
            self._update_gallery_combobox()
            self.gallery_var.set(new_name)
            self.after(1, self.gallery_box.selection_clear)
            self.load_gallery(new_name)
        else:
            self.load_gallery(name)
            self.after(1, self.gallery_box.selection_clear)

    def load_gallery(self, name: str) -> None:
        """Switch the active gallery to the one with the given name.

        Args:
            name: The gallery name to load.
        """
        self.current_gallery = self.data_manager.find_gallery(name)
        self.current_index = None
        self.current_portrait_index = 0
        self._clear_portrait()
        self.dna_text.delete("1.0", tk.END)
        self.tags_text.delete("1.0", tk.END)
        self.refresh_list()

    def _clear_portrait(self) -> None:
        """Clear the portrait canvas and overlay items."""
        if self.portrait_image_id is not None:
            self.portrait_canvas.delete(self.portrait_image_id)
            self.portrait_image_id = None
        self.portrait_photo = None
        self._clear_overlay()

    def rename_gallery(self) -> None:
        """Prompt the user to rename the current gallery."""
        assert self.current_gallery is not None
        old_name = self.current_gallery["name"]
        new_name = dialogs.ask_string(
            self, "Rename Gallery", f"Enter new name for '{old_name}':"
        )
        if not new_name or new_name == old_name:
            return
        if self.data_manager.find_gallery(new_name):
            dialogs.show_warning(
                self, "Duplicate", f"A gallery named '{new_name}' already exists."
            )
            return
        self.current_gallery["name"] = new_name
        self.current_gallery["modified"] = time.time()
        self.dirty = True
        self.save_galleries()
        self._update_gallery_combobox()
        self.gallery_var.set(new_name)
        self.after(1, self.gallery_box.selection_clear)
        self.set_status(f"Gallery renamed to '{new_name}' \u2714\ufe0f")

    def delete_gallery_confirm(self) -> None:
        """Prompt for confirmation, then delete the current gallery."""
        assert self.current_gallery is not None
        if len(self.data_manager.galleries) == 1:
            dialogs.show_warning(self, "Warning", "Cannot delete the last gallery.")
            return
        name = self.current_gallery["name"]
        if not dialogs.ask_yesno(
            self, "Delete Gallery", f"Delete gallery '{name}' and all its characters?"
        ):
            return
        self.data_manager.delete_gallery_images(self.current_gallery)
        self.data_manager.galleries.remove(self.current_gallery)
        self.dirty = True
        self.save_galleries()
        self._update_gallery_combobox()
        self.gallery_var.set(self.data_manager.galleries[0]["name"])
        self.load_gallery(self.data_manager.galleries[0]["name"])
        self.set_status(f"Gallery '{name}' deleted \u2714\ufe0f")

    # ------------------------------------------------------------------
    # Export / Import
    # ------------------------------------------------------------------

    def export_gallery(self) -> None:
        """Export the current gallery to a folder on disk."""
        assert self.current_gallery is not None
        name = self.current_gallery["name"]
        dest = filedialog.askdirectory(title=f"Export gallery '{name}' to folder")
        if not dest:
            return
        out_dir = os.path.join(dest, name)
        if os.path.exists(out_dir):
            if not dialogs.ask_yesno(
                self, "Overwrite?", f"Folder '{out_dir}' exists. Overwrite?"
            ):
                return
        self.data_manager.export_gallery(self.current_gallery, dest)
        dialogs.show_info(self, "Exported", f"Gallery '{name}' exported to {out_dir}")

    def import_gallery(self) -> None:
        """Import a gallery from a folder on disk."""
        folder = filedialog.askdirectory(title="Select gallery folder to import")
        if not folder:
            return
        json_file = os.path.join(folder, "characters.json")
        if not os.path.exists(json_file):
            dialogs.show_error(self, "Error", "No characters.json found in selected folder.")
            return
        gallery_name = dialogs.ask_string(
            self, "Import Gallery", "Enter name for imported gallery:"
        )
        if not gallery_name:
            return
        self.data_manager.import_gallery(folder, gallery_name)
        self.dirty = True
        self.save_galleries()
        self._update_gallery_combobox()
        self.gallery_var.set(gallery_name)
        self.after(1, self.gallery_box.selection_clear)
        self.load_gallery(gallery_name)
        dialogs.show_info(self, "Imported", f"Gallery '{gallery_name}' imported successfully")

    # ------------------------------------------------------------------
    # Character list display
    # ------------------------------------------------------------------

    def _update_char_count(self, filtered: bool = False) -> None:
        """Update the character counter label below the listbox."""
        assert self.current_gallery is not None
        shown = self.char_listbox.size()
        total = len(self.current_gallery["characters"])
        if filtered:
            self.char_count_label.config(text=f"Showing {shown} of {total} characters")
        else:
            self.char_count_label.config(text=f"{total} characters")

    def refresh_list(self) -> None:
        """Repopulate the character listbox, preserving any active search filter."""
        assert self.current_gallery is not None
        if not self._placeholder_active and self.search_var.get().strip():
            self.filter_list()
            return
        self.char_listbox.delete(0, tk.END)
        self._char_indices.clear()
        for i, char in enumerate(self.current_gallery["characters"]):
            self.char_listbox.insert(tk.END, char.get("name", ""))
            self._char_indices.append(i)
        self._update_char_count()

    def _on_search_focus_in(self, event: tk.Event | None = None) -> None:
        """Clear the placeholder text when the search box receives focus."""
        if self._placeholder_active:
            self.search_entry.delete(0, tk.END)
            self.search_entry.config(foreground="")
            self._placeholder_active = False

    def _on_search_focus_out(self, event: tk.Event | None = None) -> None:
        """Restore the placeholder text when the search box loses focus and is empty."""
        if not self.search_var.get().strip():
            self._placeholder_active = True
            self.search_entry.delete(0, tk.END)
            self.search_entry.insert(0, self._placeholder_text)
            self.search_entry.config(foreground="#888888")

    def filter_list(self) -> None:
        """Filter the character listbox by search term or tag query."""
        assert self.current_gallery is not None
        if self._placeholder_active:
            self.refresh_list()
            return
        term = self.search_var.get().lower()
        if not term:
            self.refresh_list()
            return
        self.char_listbox.delete(0, tk.END)
        self._char_indices.clear()
        if term.startswith(("tag:", "tags:")):
            cleaned = term.replace("tags:", "tag:", 1)
            search_tags = [t.strip() for t in cleaned[4:].split(",") if t.strip()]
            for i, char in enumerate(self.current_gallery["characters"]):
                char_tags = [t.lower() for t in char.get("tags", [])]
                if any(st in char_tags for st in search_tags):
                    self.char_listbox.insert(tk.END, char.get("name", ""))
                    self._char_indices.append(i)
            self._update_char_count(filtered=True)
        else:
            for i, char in enumerate(self.current_gallery["characters"]):
                if term in char.get("name", "").lower():
                    self.char_listbox.insert(tk.END, char.get("name", ""))
                    self._char_indices.append(i)
            self._update_char_count(filtered=True)

    def on_select(self, event: tk.Event) -> None:
        """Handle listbox selection change to load a character."""
        selection = self.char_listbox.curselection()
        if selection:
            self.select_character(self._char_idx(selection[0]))

    def select_character(self, index: int) -> None:
        """Load a character's portrait, DNA, and tags into the UI.

        Args:
            index: Index of the character within the current gallery's character list.
        """
        assert self.current_gallery is not None
        if 0 <= index < len(self.current_gallery["characters"]):
            self.current_index = index
            char = self.current_gallery["characters"][index]

            self.current_portrait_index = 0
            self._load_portrait()

            self.dna_text.delete("1.0", tk.END)
            self.dna_text.insert("1.0", char.get("dna", ""))
            self.tags_text.delete("1.0", tk.END)
            tags = char.get("tags", [])
            self.tags_text.insert("1.0", ", ".join(tags))

    def _load_portrait(self) -> None:
        """Load the current portrait image and draw overlay controls."""
        assert self.current_gallery is not None
        assert self.current_index is not None
        char = self.current_gallery["characters"][self.current_index]
        images = char.get("images", [])
        count = len(images)

        # Clear existing canvas items (except crop rect/arrows handled below)
        if self.portrait_image_id:
            self.portrait_canvas.delete(self.portrait_image_id)
            self.portrait_image_id = None
        self._clear_overlay()

        idx = self.current_portrait_index
        if 0 <= idx < count and os.path.exists(images[idx]):
            img: Image.Image = Image.open(images[idx])
            img = img.resize((450, 450), Image.Resampling.LANCZOS)
            self.portrait_photo = ImageTk.PhotoImage(img)
            self.portrait_image_id = self.portrait_canvas.create_image(
                225, 225, image=self.portrait_photo
            )

        if count > 1:
            self._draw_overlay(count)

    def _clear_overlay(self) -> None:
        """Remove arrow and counter overlay items from the portrait canvas."""
        for item_id in (self.portrait_arrow_left, self.portrait_arrow_right,
                        self.portrait_counter_id):
            if item_id is not None:
                self.portrait_canvas.delete(item_id)
        self.portrait_arrow_left = None
        self.portrait_arrow_right = None
        self.portrait_counter_id = None

    def _draw_overlay(self, count: int) -> None:
        """Draw translucent arrow buttons and portrait counter on the canvas."""
        self.portrait_arrow_left = self.portrait_canvas.create_text(
            24, 430, text="\u27f5", font=("Segoe UI", 16),
            fill="#cccccc", anchor="sw", tags="overlay",
        )
        self.portrait_arrow_right = self.portrait_canvas.create_text(
            426, 430, text="\u27f6", font=("Segoe UI", 16),
            fill="#cccccc", anchor="se", tags="overlay",
        )
        self.portrait_counter_id = self.portrait_canvas.create_text(
            225, 440, text=f"{self.current_portrait_index + 1} / {count}",
            font=("Segoe UI", 9), fill="#aaaaaa", anchor="s", tags="overlay",
        )

    def _on_portrait_click(self, event: tk.Event) -> None:
        """Handle clicks on the portrait canvas (arrows or change-portrait)."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        count = self.data_manager.portrait_count(
            self.current_gallery["characters"][self.current_index]
        )
        if count <= 1:
            self.change_portrait()
            return
        if event.x < 60:
            self._cycle_portrait(-1)
        elif event.x > 390:
            self._cycle_portrait(1)
        else:
            self.change_portrait()

    def _cycle_portrait(self, delta: int) -> None:
        """Cycle to the previous or next portrait."""
        assert self.current_gallery is not None
        assert self.current_index is not None
        count = self.data_manager.portrait_count(
            self.current_gallery["characters"][self.current_index]
        )
        if count <= 1:
            return
        self.current_portrait_index = (self.current_portrait_index + delta) % count
        self._load_portrait()

    def _add_portrait_slot(self) -> None:
        """Add an empty portrait slot (max 5)."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        char = self.current_gallery["characters"][self.current_index]
        images: list[str] = char.setdefault("images", [])
        if len(images) >= 5:
            dialogs.show_warning(self, "Limit", "Maximum 5 portraits per character.")
            return
        images.append("")
        self.current_portrait_index = len(images) - 1
        char["modified"] = time.time()
        self.dirty = True
        self.save_galleries()
        self._load_portrait()

    def _remove_portrait_slot(self) -> None:
        """Delete the current portrait slot and its image file."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        char = self.current_gallery["characters"][self.current_index]
        images: list[str] = char.get("images", [])
        if not images:
            return
        idx = self.current_portrait_index
        if 0 <= idx < len(images):
            old = images[idx]
            if old and os.path.isfile(old):
                os.remove(old)
            del images[idx]
            if self.current_portrait_index >= len(images):
                self.current_portrait_index = max(0, len(images) - 1)
            char["modified"] = time.time()
            self.dirty = True
            self.save_galleries()
            self._load_portrait()

    # ------------------------------------------------------------------
    # Character CRUD
    # ------------------------------------------------------------------

    def new_character(self) -> None:
        """Create a new character entry in the current gallery."""
        assert self.current_gallery is not None
        name = dialogs.ask_string(self, "New Character", "Enter character name:")
        if not name:
            return
        new_char = self.data_manager.create_character(name)
        self.current_gallery["characters"].append(new_char)
        self.dirty = True
        self.save_galleries()
        self.refresh_list()
        idx = len(self.current_gallery["characters"]) - 1
        self.char_listbox.selection_clear(0, tk.END)
        self.char_listbox.selection_set(idx)
        self.select_character(idx)
        self.set_status(f"Character entry '{name}' created \u2714\ufe0f")

    def delete_character(self) -> None:
        """Delete the selected character(s) after confirmation."""
        assert self.current_gallery is not None
        sel = list(self.char_listbox.curselection())
        if not sel:
            return
        if not dialogs.ask_yesno(self, "Confirm", f"Delete {len(sel)} character(s)?"):
            return
        char_indices = [self._char_idx(idx) for idx in sel]
        for idx in char_indices:
            self.data_manager.delete_character_images(
                self.current_gallery["characters"][idx]["id"]
            )
        for idx in sorted(char_indices, reverse=True):
            del self.current_gallery["characters"][idx]
        self.dirty = True
        self.save_galleries()
        self.refresh_list()
        remaining = self.char_listbox.curselection()
        if not remaining:
            if self.portrait_image_id:
                self.portrait_canvas.delete(self.portrait_image_id)
            self.portrait_image_id = None
            self.dna_text.delete("1.0", tk.END)
            self.tags_text.delete("1.0", tk.END)
            self.current_index = None
        else:
            self.select_character(remaining[0])
        self.set_status("Character entry deletion successful \u2714\ufe0f")

    def duplicate_character(self) -> None:
        """Duplicate the currently selected character."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        char = self.current_gallery["characters"][self.current_index]
        new_id = str(uuid.uuid4())
        dup_char = {
            "id": new_id,
            "name": char["name"] + " (Copy)",
            "images": [],
            "dna": char.get("dna", ""),
            "tags": char.get("tags", []).copy(),
            "created": time.time(),
            "modified": time.time(),
        }
        for img in char.get("images", []):
            if img and os.path.exists(img):
                dest = self.data_manager.add_portrait(new_id, img)
                dup_char["images"].append(dest)
        self.current_gallery["characters"].append(dup_char)
        self.dirty = True
        self.save_galleries()
        self.refresh_list()
        idx = len(self.current_gallery["characters"]) - 1
        self.char_listbox.selection_clear(0, tk.END)
        self.char_listbox.selection_set(idx)
        self.select_character(idx)
        self.set_status(f"Character '{char['name']}' duplicated \u2714\ufe0f")

    def rename_character(self) -> None:
        """Rename the currently selected character."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        idx = self.current_index
        old_name = self.current_gallery["characters"][idx]["name"]
        new_name = dialogs.ask_string(
            self, "Rename Character", f"Enter new name for '{old_name}':"
        )
        if new_name and new_name != old_name:
            self.current_gallery["characters"][idx]["name"] = new_name
            self.current_gallery["characters"][idx]["modified"] = time.time()
            self.dirty = True
            self.save_galleries()
            self.refresh_list()
            self.char_listbox.selection_set(idx)
            self.set_status(f"Character '{old_name}' renamed to '{new_name}' \u2714\ufe0f")

    # ------------------------------------------------------------------
    # Sorting & drag-drop reorder
    # ------------------------------------------------------------------

    def sort_characters(self, mode: str) -> None:
        """Sort the current gallery's character list.

        Args:
            mode: Sort mode - one of 'name_asc', 'name_desc', 'created_asc',
                  'created_desc', 'modified_desc'.
        """
        assert self.current_gallery is not None
        lst = self.current_gallery["characters"]
        if mode == "name_asc":
            lst.sort(key=lambda c: c["name"].lower())
        elif mode == "name_desc":
            lst.sort(key=lambda c: c["name"].lower(), reverse=True)
        elif mode == "created_asc":
            lst.sort(key=lambda c: c.get("created", 0))
        elif mode == "created_desc":
            lst.sort(key=lambda c: c.get("created", 0), reverse=True)
        elif mode == "modified_desc":
            lst.sort(key=lambda c: c.get("modified", 0), reverse=True)
        self.dirty = True
        self.save_galleries()
        self.refresh_list()
        self.set_status("Character entries sorted \u2714\ufe0f")

    def start_drag(self, event: tk.Event) -> None:
        """Record the starting index of a drag-drop reorder operation."""
        self._drag_idx = self._char_idx(self.char_listbox.nearest(event.y))

    def on_drop(self, event: tk.Event) -> None:
        """Complete a drag-drop reorder, moving the character to the drop position."""
        assert self.current_gallery is not None
        dst = self._char_idx(self.char_listbox.nearest(event.y))
        if dst != self._drag_idx:
            lst = self.current_gallery["characters"]
            item = lst.pop(self._drag_idx)
            lst.insert(dst, item)
            self.current_gallery["characters"][dst]["modified"] = time.time()
            self.dirty = True
            self.save_galleries()
            self.refresh_list()
            self.char_listbox.selection_set(dst)

    # ------------------------------------------------------------------
    # Portrait
    # ------------------------------------------------------------------

    def change_portrait(self) -> None:
        """Open a file dialog to select and crop a new portrait image."""
        assert self.current_gallery is not None
        if self.current_index is None:
            dialogs.show_warning(self, "Warning", "Please select a character first.")
            return
        file_path = filedialog.askopenfilename(
            title="Select Portrait Image",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif")],
        )
        if file_path:
            cropper = ImageCropper(self, file_path)
            self.wait_window(cropper)
            if cropper.result:
                img = Image.open(file_path)
                self._save_cropped_image(img, cropper.result, "Portrait updated successfully \u2714\ufe0f")

    def _save_cropped_image(
        self, img: Image.Image, crop_box: tuple[int, int, int, int], status_msg: str
    ) -> None:
        """Crop, resize, and save an image, appending it to the character's portraits."""
        assert self.current_gallery is not None
        assert self.current_index is not None
        cropped = img.crop(crop_box)
        cropped = cropped.resize((450, 450), Image.Resampling.LANCZOS)
        char = self.current_gallery["characters"][self.current_index]
        dest_dir = self.data_manager._portrait_dir(char["id"])
        os.makedirs(dest_dir, exist_ok=True)
        idx = self.current_portrait_index
        save_path = os.path.join(dest_dir, f"{idx}.png")
        cropped.save(save_path)

        images: list[str] = char.setdefault("images", [])
        # Pad with empty strings if adding beyond current length
        while len(images) <= idx:
            images.append("")
        # Remove old file if replacing an existing image
        old = images[idx]
        if old and old != save_path and os.path.isfile(old):
            os.remove(old)
        images[idx] = save_path
        char["modified"] = time.time()
        self.dirty = True
        self.save_galleries()
        self._load_portrait()
        self.set_status(status_msg)

    def paste_from_clipboard(self) -> None:
        """Paste an image from the system clipboard as the current character's portrait."""
        assert self.current_gallery is not None
        if self.current_index is None:
            return
        try:
            result = ImageGrab.grabclipboard()
            img = None
            temp_path = None
            if isinstance(result, Image.Image):
                img = result
                temp_path = os.path.join(self.data_manager.data_dir, "temp_clipboard.png")
                img.save(temp_path)
            elif isinstance(result, list) and result:
                file_path = result[0]
                ext = os.path.splitext(file_path)[1].lower()
                if ext in [".png", ".jpg", ".jpeg", ".bmp", ".gif"]:
                    temp_path = file_path
                    img = Image.open(temp_path)
            if img and temp_path:
                cropper = ImageCropper(self, temp_path)
                self.wait_window(cropper)
                if cropper.result:
                    self._save_cropped_image(img, cropper.result, "Portrait pasted successfully \u2714\ufe0f")
            if temp_path and temp_path.endswith("temp_clipboard.png") and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception as e:
            self.set_status(f"Clipboard paste failed: {e}")

    # ------------------------------------------------------------------
    # Tags & DNA editing
    # ------------------------------------------------------------------

    def on_tags_change(self, event: tk.Event | None = None) -> None:
        """Update the character's tags from the tags text widget on every keystroke."""
        assert self.current_gallery is not None
        if self.current_index is not None:
            tags_str = self.tags_text.get("1.0", tk.END).strip()
            tags = [t.strip() for t in tags_str.split(",") if t.strip()]
            self.current_gallery["characters"][self.current_index]["tags"] = tags
            self.current_gallery["characters"][self.current_index]["modified"] = time.time()
            self.dirty = True

    def on_dna_change(self, event: tk.Event | None = None) -> None:
        """Update the character's DNA string from the DNA text widget on every keystroke."""
        assert self.current_gallery is not None
        if self.current_index is not None:
            dna = self.dna_text.get("1.0", tk.END).strip()
            self.current_gallery["characters"][self.current_index]["dna"] = dna
            self.current_gallery["characters"][self.current_index]["modified"] = time.time()
            self.dirty = True

    def on_homogenize_dna(self) -> None:
        """Apply DNA homogenisation to the current DNA text and update the character."""
        assert self.current_gallery is not None
        text = self.dna_text.get("1.0", tk.END)
        new_text = homogenize_dna(text)
        self.dna_text.delete("1.0", tk.END)
        self.dna_text.insert(tk.END, new_text)
        if self.current_index is not None:
            self.current_gallery["characters"][self.current_index]["dna"] = new_text.strip()
            self.current_gallery["characters"][self.current_index]["modified"] = time.time()
            self.dirty = True
        self.set_status("DNA homogenized \u2714\ufe0f")

    def copy_dna(self) -> None:
        """Copy the current DNA text to the system clipboard."""
        data = self.dna_text.get("1.0", tk.END).strip()
        if data:
            self.clipboard_clear()
            self.clipboard_append(data)
            self.set_status("DNA copied to clipboard \u2714\ufe0f")
        else:
            dialogs.show_info(self, "Info", "No DNA to copy.")

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------

    def focus_search(self) -> None:
        """Move keyboard focus to the search entry widget."""
        self.search_entry.focus_set()
        self.search_entry.select_range(0, tk.END)

    def show_char_menu(self, event: tk.Event) -> None:
        """Show the right-click context menu for a character in the listbox."""
        idx = self._char_idx(self.char_listbox.nearest(event.y))
        if idx >= 0:
            self.char_listbox.selection_clear(0, tk.END)
            self.char_listbox.selection_set(idx)
            self.current_index = idx
            self.char_menu.tk_popup(event.x_root, event.y_root)

    def on_close(self) -> None:
        """Handle the window close event, prompting to save unsaved changes."""
        if self.dirty:
            resp = dialogs.ask_yesnocancel(
                self, "Unsaved Changes",
                "You have unsaved changes. Save before exit?",
            )
            if resp is None:
                return
            if resp:
                self.save_current()
        self._save_geometry()
        self.destroy()

    def _restore_geometry(self) -> None:
        """Restore the window position and size from a previous session."""
        try:
            with open(self._geometry_file, encoding="utf-8") as f:
                geom = json.load(f)
            self.geometry(geom)
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def _save_geometry(self) -> None:
        """Persist the current window geometry for the next session."""
        try:
            with open(self._geometry_file, "w", encoding="utf-8") as f:
                json.dump(self.geometry(), f)
        except OSError:
            pass

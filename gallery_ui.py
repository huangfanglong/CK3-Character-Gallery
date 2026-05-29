"""Main application window for the CK3 Character Gallery.

Provides the three-panel UI for managing character galleries, viewing/editing
portraits, DNA data, and tags.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk, ImageGrab
import os
import uuid
import time
from typing import Any

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
        self.configure(bg="#2e2e2e")

        self.data_manager = data_manager or DataManager()

        self.current_gallery: dict[str, Any] | None = None
        self.current_index: int | None = None
        self.dirty: bool = False
        self._drag_idx: int | None = None

        self.protocol("WM_DELETE_WINDOW", self.on_close)

        self.setup_ui()

        self.gallery_var.set(self.data_manager.galleries[0]["name"])
        self.load_gallery(self.data_manager.galleries[0]["name"])

        self._bind_hotkeys()

        self.status_label = tk.Label(
            self,
            text="Idle",
            bg="#2e2e2e",
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
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TButton", foreground="#ffffff", background="#555555")
        style.configure("TLabel", foreground="#dddddd", background="#2e2e2e")

        main_frame = tk.Frame(self, bg="#2e2e2e")
        main_frame.pack(fill="both", expand=True, padx=10, pady=10)

        self._build_left_panel(main_frame)
        self._build_middle_panel(main_frame)
        self._build_right_panel(main_frame)

    def _build_left_panel(self, parent: tk.Frame) -> None:
        """Build the gallery selector, search box, and character list."""
        list_frame = tk.Frame(parent, bg="#3a3a3a", width=200)
        list_frame.pack(side="left", fill="y", padx=(0, 10))
        list_frame.pack_propagate(False)

        top_frame = tk.Frame(list_frame, bg="#3a3a3a")
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

        menu_btn = ttk.Menubutton(top_frame, text="...", width=3)
        menu = tk.Menu(menu_btn, tearoff=False)
        menu.add_command(label="Rename Gallery", command=self.rename_gallery)
        menu.add_command(label="Delete Gallery", command=self.delete_gallery_confirm)
        menu.add_separator()
        menu.add_command(label="Export Gallery", command=self.export_gallery)
        menu.add_command(label="Import Gallery", command=self.import_gallery)
        menu.add_separator()
        sort_sub = tk.Menu(menu, tearoff=False)
        sort_sub.add_command(label="Name A→Z", command=lambda: self.sort_characters("name_asc"))
        sort_sub.add_command(label="Name Z→A", command=lambda: self.sort_characters("name_desc"))
        sort_sub.add_command(label="Created ↑", command=lambda: self.sort_characters("created_asc"))
        sort_sub.add_command(label="Created ↓", command=lambda: self.sort_characters("created_desc"))
        sort_sub.add_command(label="Modified ↓", command=lambda: self.sort_characters("modified_desc"))
        menu.add_cascade(label="Sort Characters", menu=sort_sub)
        menu_btn["menu"] = menu
        menu_btn.pack(side="left", padx=(2, 5), pady=(2, 0))
        menu_btn.configure(padding=(2, 0, 2, 0))

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(list_frame, textvariable=self.search_var)
        self.search_entry.pack(fill="x", padx=5, pady=(0, 5))
        self.search_entry.bind("<KeyRelease>", lambda e: self.filter_list())

        list_container = tk.Frame(list_frame, bg="#3a3a3a")
        list_container.pack(fill="both", expand=True)

        scrollbar = ttk.Scrollbar(list_container)
        scrollbar.pack(side="right", fill="y")

        self.char_listbox = tk.Listbox(
            list_container,
            bg="#1e1e1e",
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

        self.char_menu = tk.Menu(self, tearoff=False)
        self.char_menu.add_command(label="Rename Character", command=self.rename_character)
        self.char_listbox.bind("<Button-3>", lambda e: self.show_char_menu(e))

        btn_frame = tk.Frame(list_frame, bg="#3a3a3a")
        btn_frame.pack(fill="x", pady=5)
        ttk.Button(btn_frame, text="+ New", command=self.new_character, width=8).pack(
            side="left", padx=2
        )
        ttk.Button(btn_frame, text="Delete", command=self.delete_character, width=8).pack(
            side="right", padx=2
        )

    def _build_middle_panel(self, parent: tk.Frame) -> None:
        """Build the portrait display and tag editor."""
        portrait_frame = tk.Frame(parent, bg="#2e2e2e", width=525)
        portrait_frame.pack(side="left", fill="y", padx=10)
        portrait_frame.pack_propagate(False)

        ttk.Label(portrait_frame, text="Portrait", font=("Arial", 12, "bold")).pack(pady=5)

        self.portrait_canvas = tk.Canvas(
            portrait_frame,
            width=450,
            height=450,
            bg="#1e1e1e",
            highlightthickness=2,
            highlightbackground="#666666",
        )
        self.portrait_canvas.pack(pady=(0, 10))
        self.portrait_canvas.bind("<Button-1>", lambda e: self.change_portrait())

        self.portrait_image_id: int | None = None
        self.portrait_photo: ImageTk.PhotoImage | None = None

        ttk.Button(portrait_frame, text="Change Portrait", command=self.change_portrait).pack(pady=5)

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
            bg="#1e1e1e",
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
        dna_frame = tk.Frame(parent, bg="#2e2e2e", width=675)
        dna_frame.pack(side="right", fill="both", expand=True)

        ttk.Label(dna_frame, text="Character DNA", font=("Arial", 12, "bold")).pack(pady=5)

        text_container = tk.Frame(dna_frame, bg="#2e2e2e")
        text_container.pack(fill="both", expand=True)

        self.dna_text = tk.Text(
            text_container,
            wrap="none",
            bg="#1e1e1e",
            fg="#eeeeee",
            font=("Consolas", 10),
            insertbackground="white",
        )
        self.dna_text.pack(side="left", fill="both", expand=True)

        dna_scroll_y = ttk.Scrollbar(text_container, orient="vertical", command=self.dna_text.yview)
        dna_scroll_y.pack(side="right", fill="y")
        self.dna_text.config(yscrollcommand=dna_scroll_y.set)
        self.dna_text.bind("<KeyRelease>", self.on_dna_change)

        btns_frame = tk.Frame(dna_frame, bg="#2e2e2e")
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

    def _update_gallery_combobox(self) -> None:
        """Refresh the gallery dropdown values from the data manager."""
        self.gallery_box["values"] = self.data_manager.get_gallery_choices()

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
            messagebox.showinfo("Saved", "Character data saved successfully!")

    # ------------------------------------------------------------------
    # Gallery management
    # ------------------------------------------------------------------

    def on_gallery_change(self, event: tk.Event | None = None) -> None:
        """Handle gallery combobox selection, including 'Create new gallery'."""
        name = self.gallery_var.get()
        if name == "Create a new gallery...":
            new_name = simpledialog.askstring(
                "New Gallery", "Enter gallery name:", parent=self
            )
            if not new_name:
                self.gallery_var.set(self.current_gallery["name"])
                return
            self.data_manager.galleries.append({"name": new_name, "characters": []})
            self.dirty = True
            self.save_galleries()
            self._update_gallery_combobox()
            self.gallery_var.set(new_name)
            self.load_gallery(new_name)
        else:
            self.load_gallery(name)

    def load_gallery(self, name: str) -> None:
        """Switch the active gallery to the one with the given name.

        Args:
            name: The gallery name to load.
        """
        self.current_gallery = self.data_manager.find_gallery(name)
        self.current_index = None
        self.refresh_list()

    def rename_gallery(self) -> None:
        """Prompt the user to rename the current gallery."""
        old_name = self.current_gallery["name"]
        new_name = simpledialog.askstring(
            "Rename Gallery", f"Enter new name for '{old_name}':", parent=self
        )
        if not new_name or new_name == old_name:
            return
        self.current_gallery["name"] = new_name
        self.current_gallery["modified"] = time.time()
        self.dirty = True
        self.save_galleries()
        self._update_gallery_combobox()
        self.gallery_var.set(new_name)
        self.set_status(f"Gallery renamed to '{new_name}' \u2714\ufe0f")

    def delete_gallery_confirm(self) -> None:
        """Prompt for confirmation, then delete the current gallery."""
        if len(self.data_manager.galleries) == 1:
            messagebox.showwarning("Warning", "Cannot delete the last gallery.")
            return
        name = self.current_gallery["name"]
        if not messagebox.askyesno(
            "Delete Gallery", f"Delete gallery '{name}' and all its characters?"
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
        name = self.current_gallery["name"]
        dest = filedialog.askdirectory(title=f"Export gallery '{name}' to folder")
        if not dest:
            return
        out_dir = os.path.join(dest, name)
        if os.path.exists(out_dir):
            if not messagebox.askyesno(
                "Overwrite?", f"Folder '{out_dir}' exists. Overwrite?"
            ):
                return
        self.data_manager.export_gallery(self.current_gallery, dest)
        messagebox.showinfo("Exported", f"Gallery '{name}' exported to {out_dir}")

    def import_gallery(self) -> None:
        """Import a gallery from a folder on disk."""
        folder = filedialog.askdirectory(title="Select gallery folder to import")
        if not folder:
            return
        json_file = os.path.join(folder, "characters.json")
        if not os.path.exists(json_file):
            messagebox.showerror("Error", "No characters.json found in selected folder.")
            return
        gallery_name = simpledialog.askstring(
            "Import Gallery", "Enter name for imported gallery:", parent=self
        )
        if not gallery_name:
            return
        self.data_manager.import_gallery(folder, gallery_name)
        self.dirty = True
        self.save_galleries()
        self._update_gallery_combobox()
        self.gallery_var.set(gallery_name)
        self.load_gallery(gallery_name)
        messagebox.showinfo("Imported", f"Gallery '{gallery_name}' imported successfully")

    # ------------------------------------------------------------------
    # Character list display
    # ------------------------------------------------------------------

    def refresh_list(self) -> None:
        """Repopulate the character listbox from the current gallery's characters."""
        self.char_listbox.delete(0, tk.END)
        for char in self.current_gallery["characters"]:
            self.char_listbox.insert(tk.END, char.get("name", ""))

    def filter_list(self) -> None:
        """Filter the character listbox by search term or tag query."""
        term = self.search_var.get().lower()
        self.char_listbox.delete(0, tk.END)
        if term.startswith(("tag:", "tags:")):
            cleaned = term.replace("tags:", "tag:", 1)
            search_tags = [t.strip() for t in cleaned[4:].split(",") if t.strip()]
            for char in self.current_gallery["characters"]:
                char_tags = [t.lower() for t in char.get("tags", [])]
                if any(st in char_tags for st in search_tags):
                    self.char_listbox.insert(tk.END, char.get("name", ""))
        else:
            for char in self.current_gallery["characters"]:
                if term in char.get("name", "").lower():
                    self.char_listbox.insert(tk.END, char.get("name", ""))

    def on_select(self, event: tk.Event) -> None:
        """Handle listbox selection change to load a character."""
        selection = self.char_listbox.curselection()
        if selection:
            self.select_character(selection[0])

    def select_character(self, index: int) -> None:
        """Load a character's portrait, DNA, and tags into the UI.

        Args:
            index: Index of the character within the current gallery's character list.
        """
        if 0 <= index < len(self.current_gallery["characters"]):
            self.current_index = index
            char = self.current_gallery["characters"][index]

            image_file = char.get("image")
            if image_file and os.path.exists(image_file):
                img = Image.open(image_file)
                img = img.resize((450, 450), Image.Resampling.LANCZOS)
                self.portrait_photo = ImageTk.PhotoImage(img)
                if self.portrait_image_id:
                    self.portrait_canvas.delete(self.portrait_image_id)
                self.portrait_image_id = self.portrait_canvas.create_image(
                    225, 225, image=self.portrait_photo
                )
            else:
                if self.portrait_image_id:
                    self.portrait_canvas.delete(self.portrait_image_id)
                self.portrait_image_id = None

            self.dna_text.delete("1.0", tk.END)
            self.dna_text.insert("1.0", char.get("dna", ""))
            self.tags_text.delete("1.0", tk.END)
            tags = char.get("tags", [])
            self.tags_text.insert("1.0", ", ".join(tags))

    # ------------------------------------------------------------------
    # Character CRUD
    # ------------------------------------------------------------------

    def new_character(self) -> None:
        """Create a new character entry in the current gallery."""
        name = simpledialog.askstring("New Character", "Enter character name:", parent=self)
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
        sel = list(self.char_listbox.curselection())
        if not sel:
            return
        if not messagebox.askyesno("Confirm", f"Delete {len(sel)} character(s)?"):
            return
        for idx in sel:
            char = self.current_gallery["characters"][idx]
            self.data_manager.delete_image(char.get("image"))
        for idx in sorted(sel, reverse=True):
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
        if self.current_index is None:
            return
        char = self.current_gallery["characters"][self.current_index]
        new_id = str(uuid.uuid4())
        dup_char = {
            "id": new_id,
            "name": char["name"] + " (Copy)",
            "image": None,
            "dna": char.get("dna", ""),
            "tags": char.get("tags", []).copy(),
            "created": time.time(),
            "modified": time.time(),
        }
        if char.get("image") and os.path.exists(char["image"]):
            dup_char["image"] = self.data_manager.copy_image_to_storage(
                char["image"], new_id
            )
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
        if self.current_index is None:
            return
        idx = self.current_index
        old_name = self.current_gallery["characters"][idx]["name"]
        new_name = simpledialog.askstring(
            "Rename Character", f"Enter new name for '{old_name}':", parent=self
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
        self._drag_idx = self.char_listbox.nearest(event.y)

    def on_drop(self, event: tk.Event) -> None:
        """Complete a drag-drop reorder, moving the character to the drop position."""
        dst = self.char_listbox.nearest(event.y)
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
        if self.current_index is None:
            messagebox.showwarning("Warning", "Please select a character first.")
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
                cropped = img.crop(cropper.result)
                cropped = cropped.resize((450, 450), Image.Resampling.LANCZOS)
                char_id = self.current_gallery["characters"][self.current_index]["id"]
                save_path = self.data_manager.get_image_path(char_id)
                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                cropped.save(save_path)
                self.current_gallery["characters"][self.current_index]["image"] = save_path
                self.current_gallery["characters"][self.current_index]["modified"] = time.time()
                self.dirty = True
                self.save_galleries()
                self.select_character(self.current_index)
                self.set_status("Portrait updated successfully \u2714\ufe0f")

    def paste_from_clipboard(self) -> None:
        """Paste an image from the system clipboard as the current character's portrait."""
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
                    cropped = img.crop(cropper.result)
                    cropped = cropped.resize((450, 450), Image.Resampling.LANCZOS)
                    char_id = self.current_gallery["characters"][self.current_index]["id"]
                    save_path = self.data_manager.get_image_path(char_id)
                    os.makedirs(os.path.dirname(save_path), exist_ok=True)
                    cropped.save(save_path)
                    self.current_gallery["characters"][self.current_index]["image"] = save_path
                    self.current_gallery["characters"][self.current_index]["modified"] = time.time()
                    self.dirty = True
                    self.save_galleries()
                    self.select_character(self.current_index)
                    self.set_status("Portrait pasted successfully \u2714\ufe0f")
            if temp_path and temp_path.endswith("temp_clipboard.png") and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception as e:
            self.set_status(f"Clipboard paste failed: {e}")

    # ------------------------------------------------------------------
    # Tags & DNA editing
    # ------------------------------------------------------------------

    def on_tags_change(self, event: tk.Event | None = None) -> None:
        """Update the character's tags from the tags text widget on every keystroke."""
        if self.current_index is not None:
            tags_str = self.tags_text.get("1.0", tk.END).strip()
            tags = [t.strip() for t in tags_str.split(",") if t.strip()]
            self.current_gallery["characters"][self.current_index]["tags"] = tags
            self.current_gallery["characters"][self.current_index]["modified"] = time.time()
            self.dirty = True

    def on_dna_change(self, event: tk.Event | None = None) -> None:
        """Update the character's DNA string from the DNA text widget on every keystroke."""
        if self.current_index is not None:
            dna = self.dna_text.get("1.0", tk.END).strip()
            self.current_gallery["characters"][self.current_index]["dna"] = dna
            self.current_gallery["characters"][self.current_index]["modified"] = time.time()
            self.dirty = True

    def on_homogenize_dna(self) -> None:
        """Apply DNA homogenisation to the current DNA text and update the character."""
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
            messagebox.showinfo("Info", "No DNA to copy.")

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------

    def focus_search(self) -> None:
        """Move keyboard focus to the search entry widget."""
        self.search_entry.focus_set()
        self.search_entry.select_range(0, tk.END)

    def show_char_menu(self, event: tk.Event) -> None:
        """Show the right-click context menu for a character in the listbox."""
        idx = self.char_listbox.nearest(event.y)
        if idx >= 0:
            self.char_listbox.selection_clear(0, tk.END)
            self.char_listbox.selection_set(idx)
            self.current_index = idx
            self.char_menu.tk_popup(event.x_root, event.y_root)

    def on_close(self) -> None:
        """Handle the window close event, prompting to save unsaved changes."""
        if self.dirty:
            resp = messagebox.askyesnocancel(
                "Unsaved Changes",
                "You have unsaved changes. Save before exit?",
            )
            if resp is None:
                return
            if resp:
                self.save_current()
        self.destroy()

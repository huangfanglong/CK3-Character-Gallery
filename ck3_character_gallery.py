import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk
import os
import json
import shutil
import uuid

class ImageCropper(tk.Toplevel):
    """Modal dialog for cropping/repositioning images with zoom selection."""
    def __init__(self, parent, image_path):
        super().__init__(parent)
        self.title("Adjust Image Position")
        self.geometry("600x650")
        self.configure(bg="#2e2e2e")
        self.transient(parent)
        self.grab_set()

        self.result = None
        self.image_path = image_path

        # Load original image
        self.original = Image.open(image_path)
        self.display_size = 500
        self.crop_size = 300

        # Scale image
        self.scale_factor = min(self.display_size / self.original.width,
                                self.display_size / self.original.height)

        # Canvas for image
        self.canvas = tk.Canvas(self, width=self.display_size, height=self.display_size,
                                bg="#1e1e1e", highlightthickness=2, highlightbackground="#666666")
        self.canvas.pack(pady=10)

        # Initial display
        self._update_display_image()

        # Crop rectangle
        cx = self.display_size // 2
        cy = self.display_size // 2
        self.crop_rect = self.canvas.create_rectangle(
            cx - self.crop_size//2, cy - self.crop_size//2,
            cx + self.crop_size//2, cy + self.crop_size//2,
            outline="red", width=3
        )

        # Instructions
        ttk.Label(self, text="Drag the image to reposition, scroll to zoom. Red box shows visible area.",
                  background="#2e2e2e", foreground="#dddddd").pack()

        # Buttons
        btn_frame = tk.Frame(self, bg="#2e2e2e")
        btn_frame.pack(pady=10)
        ttk.Button(btn_frame, text="OK", command=self.ok, width=10).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Cancel", command=self.cancel, width=10).pack(side="left", padx=5)

        # Bind events
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<MouseWheel>", self.on_zoom)       # Windows/macOS
        self.canvas.bind("<Button-4>", self.on_zoom)         # Linux scroll up
        self.canvas.bind("<Button-5>", self.on_zoom)         # Linux scroll down

        self.drag_start_x = 0
        self.drag_start_y = 0

    def _update_display_image(self):
        # Resize and draw on canvas
        disp_w = int(self.original.width * self.scale_factor)
        disp_h = int(self.original.height * self.scale_factor)
        self.display_image = self.original.resize((disp_w, disp_h), Image.Resampling.LANCZOS)
        self.photo = ImageTk.PhotoImage(self.display_image)
        if hasattr(self, 'image_id'):
            self.canvas.delete(self.image_id)
        x = self.display_size // 2
        y = self.display_size // 2
        self.image_id = self.canvas.create_image(x, y, image=self.photo)
        # Keep red outline crop box preview on top of image when zoomies
        if hasattr(self, 'crop_rect'):
            self.canvas.tag_raise(self.crop_rect)

    def on_press(self, event):
        self.drag_start_x = event.x
        self.drag_start_y = event.y

    def on_drag(self, event):
        dx = event.x - self.drag_start_x
        dy = event.y - self.drag_start_y
        self.canvas.move(self.image_id, dx, dy)
        self.drag_start_x = event.x
        self.drag_start_y = event.y

    def on_zoom(self, event):
        # Zoom in/out
        factor = 1.1 if getattr(event, 'delta', 0) > 0 or getattr(event, 'num', None) == 4 else 0.9
        self.scale_factor *= factor
        # Clamp scale_factor
        min_scale = max(self.display_size / self.original.width,
                        self.display_size / self.original.height) * 0.1
        max_scale = 10.0
        self.scale_factor = max(min_scale, min(self.scale_factor, max_scale))
        # Redraw image centered at current canvas coords
        coords = self.canvas.coords(self.image_id)
        self._update_display_image()
        self.canvas.coords(self.image_id, coords)

    def ok(self):
        # Get image position and calculate crop box in original coordinates
        coords = self.canvas.coords(self.image_id)
        img_x, img_y = coords[0], coords[1]

        # Crop box center
        crop_cx = self.display_size // 2
        crop_cy = self.display_size // 2

        # Calculate offset from image center to crop center
        offset_x = (crop_cx - img_x) / self.scale_factor
        offset_y = (crop_cy - img_y) / self.scale_factor

        # Original crop size
        orig_crop_size = self.crop_size / self.scale_factor

        # Calculate crop box in original image coordinates
        orig_cx = self.original.width / 2 + offset_x
        orig_cy = self.original.height / 2 + offset_y

        left = max(0, orig_cx - orig_crop_size / 2)
        top = max(0, orig_cy - orig_crop_size / 2)
        right = min(self.original.width, orig_cx + orig_crop_size / 2)
        bottom = min(self.original.height, orig_cy + orig_crop_size / 2)

        self.result = (int(left), int(top), int(right), int(bottom))
        self.destroy()

    def cancel(self):
        self.result = None
        self.destroy()

class CharacterGallery(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("CK3 Character Gallery")
        self.geometry("1200x700")
        self.configure(bg="#2e2e2e")

        # Data directory
        self.data_dir = "character_gallery_data"
        self.images_dir = os.path.join(self.data_dir, "images")
        self.data_file = os.path.join(self.data_dir, "characters.json")

        os.makedirs(self.images_dir, exist_ok=True)

        # Load data (character container)
        self.characters = []
        self.current_index = None

        self.setup_ui()
        self.load_data()
        if self.characters:
            self.select_character(0)

        # Hotkeys
        self.bind_all("<Control-s>", lambda e: self.save_current())
        self.bind_all("<Control-S>", lambda e: self.save_current())
        # Enable undo in DNA text and bind Ctrl+Z
        self.dna_text.config(undo=True, autoseparators=True, maxundo=-1)
        self.dna_text.bind("<Control-z>", lambda e: self.dna_text.edit_undo())
        self.dna_text.bind("<Control-Z>", lambda e: self.dna_text.edit_undo())

        # Persistent status bar
        self.status_label = ttk.Label(
            self, text="Idle", background="#2e2e2e", foreground="#888888"
        )
        self.status_label.pack(side="bottom", fill="x", padx=10, pady=0)

    def setup_ui(self):
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TButton", foreground="#ffffff", background="#555555")
        style.configure("TLabel", foreground="#dddddd", background="#2e2e2e")

        main_frame = tk.Frame(self, bg="#2e2e2e")
        main_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # LEFT: Character list
        list_frame = tk.Frame(main_frame, bg="#3a3a3a", width=200)
        list_frame.pack(side="left", fill="y", padx=(0, 10))
        list_frame.pack_propagate(False)

        ttk.Label(list_frame, text="Characters", font=("Arial", 12, "bold")).pack(pady=5)

        list_container = tk.Frame(list_frame, bg="#3a3a3a")
        list_container.pack(fill="both", expand=True)

        scrollbar = ttk.Scrollbar(list_container)
        scrollbar.pack(side="right", fill="y")

        self.char_listbox = tk.Listbox(
            list_container, bg="#1e1e1e", fg="#eeeeee",
            font=("Arial", 10), selectmode="extended",
            yscrollcommand=scrollbar.set, highlightthickness=0
        )
        self.char_listbox.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self.char_listbox.yview)

        self.char_listbox.bind("<<ListboxSelect>>", self.on_select)

        btn_frame = tk.Frame(list_frame, bg="#3a3a3a")
        btn_frame.pack(fill="x", pady=5)

        ttk.Button(btn_frame, text="+ New", command=self.new_character, width=8).pack(side="left", padx=2)
        ttk.Button(btn_frame, text="Delete", command=self.delete_character, width=8).pack(side="right", padx=2)

        # MIDDLE: Portrait
        portrait_frame = tk.Frame(main_frame, bg="#2e2e2e", width=350)
        portrait_frame.pack(side="left", fill="y", padx=10)
        portrait_frame.pack_propagate(False)

        ttk.Label(portrait_frame, text="Portrait", font=("Arial", 12, "bold")).pack(pady=5)

        self.portrait_canvas = tk.Canvas(
            portrait_frame, width=300, height=300,
            bg="#1e1e1e", highlightthickness=2, highlightbackground="#666666"
        )
        self.portrait_canvas.pack(pady=10)

        self.portrait_image_id = None
        self.portrait_photo = None

        ttk.Button(portrait_frame, text="Change Portrait", command=self.change_portrait).pack(pady=5)

        # RIGHT: DNA text
        dna_frame = tk.Frame(main_frame, bg="#2e2e2e")
        dna_frame.pack(side="right", fill="both", expand=True)

        ttk.Label(dna_frame, text="Character DNA", font=("Arial", 12, "bold")).pack(pady=5)

        # Wrap the text and its scrollbar together
        text_container = tk.Frame(dna_frame, bg="#2e2e2e")
        text_container.pack(fill="both", expand=True)

        self.dna_text = tk.Text(
            text_container, wrap="none", bg="#1e1e1e", fg="#eeeeee",
            font=("Consolas", 10), insertbackground="white"
        )
        self.dna_text.pack(side="left", fill="both", expand=True)

        dna_scroll_y = ttk.Scrollbar(
            text_container, orient="vertical", command=self.dna_text.yview
        )
        dna_scroll_y.pack(side="right", fill="y")
        self.dna_text.config(yscrollcommand=dna_scroll_y.set)
        self.dna_text.bind("<KeyRelease>", self.on_dna_change)

        # Clear, Homogenize, Copy buttons below the DNA box
        btns_frame = tk.Frame(dna_frame, bg="#2e2e2e")
        btns_frame.pack(fill="x", pady=5)
        # Left-side buttons
        ttk.Button(btns_frame, text="Clear DNA", command=lambda: self.dna_text.delete('1.0', tk.END), width=12)\
            .pack(side="left", padx=(0,5))
        ttk.Button(btns_frame, text="Homogenize DNA", command=self.homogenize_dna, width=16)\
            .pack(side="left", padx=(0,5))
        # Center button
        ttk.Button(btns_frame, text="Save Changes", command=self.save_current, width=12)\
            .pack(side="left", expand=True)
        # Right-side button
        ttk.Button(btns_frame, text="Copy DNA", command=self.copy_dna, width=12)\
            .pack(side="right", padx=(5,0))

    def load_data(self):
        if os.path.exists(self.data_file):
            with open(self.data_file, 'r', encoding='utf-8') as f:
                self.characters = json.load(f)
        self.refresh_list()

    def save_data(self):
        with open(self.data_file, 'w', encoding='utf-8') as f:
            json.dump(self.characters, f, indent=2)

    def refresh_list(self):
        self.char_listbox.delete(0, tk.END)
        for i, char in enumerate(self.characters):
            name = char.get('name', f'Character {i+1}')
            self.char_listbox.insert(tk.END, name)

    def on_select(self, event):
        selection = self.char_listbox.curselection()
        if selection:
            self.select_character(selection[0])

    def select_character(self, index):
        if 0 <= index < len(self.characters):
            self.current_index = index
            char = self.characters[index]

            # Load portrait
            image_file = char.get('image')
            if image_file and os.path.exists(image_file):
                img = Image.open(image_file)
                img = img.resize((300, 300), Image.Resampling.LANCZOS)
                self.portrait_photo = ImageTk.PhotoImage(img)

                if self.portrait_image_id:
                    self.portrait_canvas.delete(self.portrait_image_id)
                self.portrait_image_id = self.portrait_canvas.create_image(
                    150, 150, image=self.portrait_photo
                )
            else:
                if self.portrait_image_id:
                    self.portrait_canvas.delete(self.portrait_image_id)
                self.portrait_image_id = None

            # Load DNA
            self.dna_text.delete("1.0", tk.END)
            self.dna_text.insert("1.0", char.get('dna', ''))

    def new_character(self):
        name = simpledialog.askstring("New Character", "Enter character name:", parent=self)
        if not name:
            return
        char_id = str(uuid.uuid4())
        new_char = {
            'id': char_id,
            'name': name,
            'image': None,
            'dna': ''
        }
        self.characters.append(new_char)
        self.save_data()
        self.refresh_list()
        idx = len(self.characters) - 1
        self.char_listbox.selection_clear(0, tk.END)
        self.char_listbox.selection_set(idx)
        self.select_character(idx)
        self.status_label.config(text=f"Character entry '{name}' created ✔️")
        self.after(5000, lambda: self.status_label.config(text="Idle"))

    def delete_character(self):
        sel = list(self.char_listbox.curselection())
        if not sel:
            return
        if not messagebox.askyesno("Confirm", f"Delete {len(sel)} character(s)?"):
            return
        for idx in sorted(sel, reverse=True):
            char = self.characters[idx]
            if char.get('image') and os.path.exists(char['image']):
                os.remove(char['image'])
            del self.characters[idx]
        self.save_data()
        self.refresh_list()
        self.status_label.config(text="Character entry deletion successful ✔️")
        self.after(5000, lambda: self.status_label.config(text="Idle"))
        if self.characters:
            next_idx = min(sel[0], len(self.characters) - 1)
            self.char_listbox.selection_set(next_idx)
            self.select_character(next_idx)
        else:
            self.current_index = None

    def change_portrait(self):
        if self.current_index is None:
            messagebox.showwarning("Warning", "Please select a character first.")
            return

        file_path = filedialog.askopenfilename(
            title="Select Portrait Image",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif")]
        )

        if file_path:
            # Open cropper dialog
            cropper = ImageCropper(self, file_path)
            self.wait_window(cropper)

            if cropper.result:
                # Crop and save
                img = Image.open(file_path)
                cropped = img.crop(cropper.result)
                cropped = cropped.resize((300, 300), Image.Resampling.LANCZOS)

                # Save to data directory
                char_id = self.characters[self.current_index]['id']
                save_path = os.path.join(self.images_dir, f"{char_id}.png")
                cropped.save(save_path)

                self.characters[self.current_index]['image'] = save_path
                self.save_data()
                self.select_character(self.current_index)

    def on_dna_change(self, event=None):
        if self.current_index is not None:
            self.characters[self.current_index]['dna'] = self.dna_text.get("1.0", tk.END).strip()

    def save_current(self):
        if self.current_index is not None:
            self.save_data()
            self.status_label.config(text="Character data saved successfully ✔️")
            self.after(5000, lambda: self.status_label.config(text="Idle"))
            messagebox.showinfo("Saved", "Character data saved successfully!")

    def homogenize_dna(self):
        text = self.dna_text.get("1.0", tk.END)
        import re
        pattern = re.compile(r'^(\s*[\w_]+\s*=\s*\{\s*)("[^"]+"|\d+)\s+(\d+)\s+("[^"]+"|\d+)\s+(\d+)\s*(\})', re.MULTILINE)
        def repl(m):
            return f"{m.group(1)}{m.group(2)} {m.group(3)} {m.group(2)} {m.group(3)} {m.group(6)}"
        new = pattern.sub(repl, text)
        self.dna_text.delete("1.0", tk.END)
        self.dna_text.insert(tk.END, new)
        # Sync model so save_current writes this updated DNA
        if self.current_index is not None:
            self.characters[self.current_index]['dna'] = new.strip()
        self.status_label.config(text="DNA homogenized")
        self.after(5000, lambda: self.status_label.config(text="Idle"))

    def copy_dna(self):
        data = self.dna_text.get("1.0", tk.END).strip()
        if data:
            self.clipboard_clear()
            self.clipboard_append(data)
            self.status_label.config(text="DNA copied to clipboard ✔️")
            self.after(5000, lambda: self.status_label.config(text="Idle"))
        else:
            messagebox.showinfo("Info", "No DNA to copy.")

if __name__ == "__main__":
    app = CharacterGallery()
    app.mainloop()

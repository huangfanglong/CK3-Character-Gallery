import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
import os
import json
import shutil
import uuid

class ImageCropper(tk.Toplevel):
    """Modal dialog for cropping/repositioning images."""
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

        # Scale image for display
        self.scale_factor = min(self.display_size / self.original.width,
                                self.display_size / self.original.height)
        display_width = int(self.original.width * self.scale_factor)
        display_height = int(self.original.height * self.scale_factor)

        self.display_image = self.original.resize((display_width, display_height), Image.Resampling.LANCZOS)

        # Canvas for image
        self.canvas = tk.Canvas(self, width=self.display_size, height=self.display_size,
                               bg="#1e1e1e", highlightthickness=2, highlightbackground="#666666")
        self.canvas.pack(pady=10)

        self.photo = ImageTk.PhotoImage(self.display_image)
        self.image_id = self.canvas.create_image(self.display_size//2, self.display_size//2,
                                                 image=self.photo)

        # Crop box (300x300 in the center)
        self.crop_size = 300
        cx = self.display_size // 2
        cy = self.display_size // 2
        self.crop_rect = self.canvas.create_rectangle(
            cx - self.crop_size//2, cy - self.crop_size//2,
            cx + self.crop_size//2, cy + self.crop_size//2,
            outline="red", width=3
        )

        # Instructions
        ttk.Label(self, text="Drag the image to reposition. Red box shows visible area.",
                 background="#2e2e2e", foreground="#dddddd").pack()

        # Buttons
        btn_frame = tk.Frame(self, bg="#2e2e2e")
        btn_frame.pack(pady=10)
        ttk.Button(btn_frame, text="OK", command=self.ok, width=10).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Cancel", command=self.cancel, width=10).pack(side="left", padx=5)

        # Bind drag
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)

        self.drag_start_x = 0
        self.drag_start_y = 0

    def on_press(self, event):
        self.drag_start_x = event.x
        self.drag_start_y = event.y

    def on_drag(self, event):
        dx = event.x - self.drag_start_x
        dy = event.y - self.drag_start_y
        self.canvas.move(self.image_id, dx, dy)
        self.drag_start_x = event.x
        self.drag_start_y = event.y

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

        # Load data
        self.characters = []
        self.current_index = None

        self.setup_ui()
        self.load_data()
        if self.characters:
            self.select_character(0)

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
            font=("Arial", 10), selectmode="single",
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

        # Save button below the text container
        save_frame = tk.Frame(dna_frame, bg="#2e2e2e")
        save_frame.pack(fill="x", pady=5)
        ttk.Button(save_frame, text="Save Changes", command=self.save_current).pack()

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
        char_id = str(uuid.uuid4())
        new_char = {
            'id': char_id,
            'name': f'Character {len(self.characters) + 1}',
            'image': None,
            'dna': ''
        }
        self.characters.append(new_char)
        self.save_data()
        self.refresh_list()
        self.select_character(len(self.characters) - 1)
        self.char_listbox.selection_clear(0, tk.END)
        self.char_listbox.selection_set(len(self.characters) - 1)

    def delete_character(self):
        if self.current_index is not None:
            if messagebox.askyesno("Confirm", "Delete this character?"):
                char = self.characters[self.current_index]
                # Delete image file
                if char.get('image') and os.path.exists(char['image']):
                    os.remove(char['image'])
                del self.characters[self.current_index]
                self.save_data()
                self.refresh_list()
                if self.characters:
                    self.select_character(min(self.current_index, len(self.characters) - 1))
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
            messagebox.showinfo("Saved", "Character data saved successfully!")

if __name__ == "__main__":
    app = CharacterGallery()
    app.mainloop()

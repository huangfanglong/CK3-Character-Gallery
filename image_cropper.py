"""Modal dialog for cropping and repositioning character portrait images.

Provides a zoomable, draggable canvas with a fixed crop overlay that lets users
select the visible region of a source image before saving it as a portrait.
"""

import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageTk


class ImageCropper(tk.Toplevel):
    """Modal dialog for adjusting image crop/position before saving as a portrait.

    The user can drag the image to reposition it and use the scroll wheel to
    zoom in or out.  A red rectangle indicates the visible crop area.
    """

    def __init__(self, parent: tk.Tk | tk.Toplevel, image_path: str) -> None:
        """Initialise the cropper dialog.

        Args:
            parent: The parent Tkinter window.
            image_path: Path to the source image file to crop.
        """
        super().__init__(parent)
        self.title("Adjust Image Position")
        self.geometry("700x800")
        self.configure(bg="#2e2e2e")
        self.transient(parent)
        self.grab_set()

        self.result: tuple[int, int, int, int] | None = None
        self.image_path: str = image_path

        self.original: Image.Image = Image.open(image_path)
        self.display_size: int = 600
        self.crop_size: int = 300
        self.image_id: int | None = None

        self.scale_factor: float = min(
            self.display_size / self.original.width,
            self.display_size / self.original.height,
        )

        self.canvas = tk.Canvas(
            self,
            width=self.display_size,
            height=self.display_size,
            bg="#1e1e1e",
            highlightthickness=2,
            highlightbackground="#666666",
        )
        self.canvas.pack(pady=10)

        cx = self.display_size // 2
        cy = self.display_size // 2
        self.crop_rect = self.canvas.create_rectangle(
            cx - self.crop_size // 2,
            cy - self.crop_size // 2,
            cx + self.crop_size // 2,
            cy + self.crop_size // 2,
            outline="red",
            width=3,
        )

        self._update_display_image()

        ttk.Label(
            self,
            text="Drag the image to reposition, scroll to zoom. Red box shows visible area.",
            background="#2e2e2e",
            foreground="#dddddd",
        ).pack()

        btn_frame = tk.Frame(self, bg="#2e2e2e")
        btn_frame.pack(pady=10)
        ttk.Button(btn_frame, text="OK", command=self.ok, width=10).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Cancel", command=self.cancel, width=10).pack(side="left", padx=5)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<MouseWheel>", self.on_zoom)
        self.canvas.bind("<Button-4>", self.on_zoom)
        self.canvas.bind("<Button-5>", self.on_zoom)

        self.drag_start_x: int = 0
        self.drag_start_y: int = 0

    def _update_display_image(self) -> None:
        """Resize and redraw the image on the canvas at the current scale factor."""
        disp_w = int(self.original.width * self.scale_factor)
        disp_h = int(self.original.height * self.scale_factor)
        self.display_image = self.original.resize((disp_w, disp_h), Image.Resampling.LANCZOS)
        self.photo = ImageTk.PhotoImage(self.display_image)
        if self.image_id is not None:
            self.canvas.delete(self.image_id)
        x = self.display_size // 2
        y = self.display_size // 2
        self.image_id = self.canvas.create_image(x, y, image=self.photo)
        if self.crop_rect is not None:
            self.canvas.tag_raise(self.crop_rect)

    def on_press(self, event: tk.Event) -> None:
        """Begin a drag operation, recording the starting cursor position."""
        self.drag_start_x = event.x
        self.drag_start_y = event.y

    def on_drag(self, event: tk.Event) -> None:
        """Drag the image by the delta from the last recorded cursor position."""
        assert self.image_id is not None
        dx = event.x - self.drag_start_x
        dy = event.y - self.drag_start_y
        self.canvas.move(self.image_id, dx, dy)
        self.drag_start_x = event.x
        self.drag_start_y = event.y

    def on_zoom(self, event: tk.Event) -> None:
        """Zoom the image in or out, clamping to a reasonable scale range."""
        delta = getattr(event, "delta", 0)
        num = getattr(event, "num", None)
        factor = 1.1 if delta > 0 or num == 4 else 0.9
        self.scale_factor *= factor

        min_scale = max(
            self.display_size / self.original.width,
            self.display_size / self.original.height,
        ) * 0.1
        max_scale = 10.0
        self.scale_factor = max(min_scale, min(self.scale_factor, max_scale))

        assert self.image_id is not None
        coords = self.canvas.coords(self.image_id)
        self._update_display_image()
        self.canvas.coords(self.image_id, coords)

    def ok(self) -> None:
        """Calculate the crop rectangle in original image space and close the dialog."""
        assert self.image_id is not None
        coords = self.canvas.coords(self.image_id)
        img_x, img_y = coords[0], coords[1]

        crop_cx = self.display_size // 2
        crop_cy = self.display_size // 2

        offset_x = (crop_cx - img_x) / self.scale_factor
        offset_y = (crop_cy - img_y) / self.scale_factor

        orig_crop_size = self.crop_size / self.scale_factor

        orig_cx = self.original.width / 2 + offset_x
        orig_cy = self.original.height / 2 + offset_y

        left = max(0, orig_cx - orig_crop_size / 2)
        top = max(0, orig_cy - orig_crop_size / 2)
        right = min(self.original.width, orig_cx + orig_crop_size / 2)
        bottom = min(self.original.height, orig_cy + orig_crop_size / 2)

        self.result = (int(left), int(top), int(right), int(bottom))
        self.destroy()

    def cancel(self) -> None:
        """Close the dialog without returning a crop result."""
        self.result = None
        self.destroy()

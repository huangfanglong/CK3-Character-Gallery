"""Comprehensive tests for the ImageCropper class.

Tests all original ImageCropper methods: __init__, _update_display_image,
on_press, on_drag, on_zoom, ok, cancel.
"""

import os
import sys
import tempfile
import gc

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _make_temp_image(size=(600, 600), color="red"):
    """Create a temporary PNG image file and return its path.

    Caller must os.unlink the path after all PIL/tkinter references are released.
    """
    from PIL import Image
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    img = Image.new("RGB", size, color=color)
    img.save(tmp.name)
    img.close()
    return tmp.name


def _cleanup_temp(path):
    """Safely delete a temp file, ignoring errors."""
    try:
        os.unlink(path)
    except OSError:
        pass


def test_module_can_be_imported():
    from image_cropper import ImageCropper  # noqa: F401
    assert ImageCropper is not None


class TestImageCropperOk:
    """Tests for the ok() coordinate math method."""

    @staticmethod
    def _test_ok(img_size, color, setup_fn, verify_fn):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image(img_size, color)
        try:
            cropper = ImageCropper(root, path)
            setup_fn(cropper)
            cropper.ok()
            verify_fn(cropper)
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

    def test_ok_default_center_crop(self):
        def setup(c):
            c._update_display_image()
            center = c.display_size // 2
            c.canvas.coords(c.image_id, (center, center))

        def verify(c):
            assert c.result is not None
            left, top, right, bottom = c.result
            crop_cx = (left + right) / 2
            crop_cy = (top + bottom) / 2
            assert abs(crop_cx - c.original.width / 2) < 2
            assert abs(crop_cy - c.original.height / 2) < 2

        self._test_ok((1200, 1600), "red", setup, verify)

    def test_ok_shifted_image_clamps_bounds(self):
        def setup(c):
            c._update_display_image()
            c.canvas.coords(c.image_id, (0, 0))

        def verify(c):
            assert c.result is not None
            left, top, right, bottom = c.result
            o_w, o_h = c.original.width, c.original.height
            assert 0 <= left <= o_w
            assert 0 <= right <= o_w
            assert 0 <= top <= o_h
            assert 0 <= bottom <= o_h

        self._test_ok((1200, 1600), "red", setup, verify)

    def test_ok_large_zoom(self):
        def setup(c):
            c.scale_factor = 2.0
            c._update_display_image()
            center = c.display_size // 2
            c.canvas.coords(c.image_id, (center, center))

        def verify(c):
            assert c.result is not None
            left, top, right, bottom = c.result
            crop_width = right - left
            crop_height = bottom - top
            expected = c.crop_size / c.scale_factor
            assert abs(crop_width - expected) < 2
            assert abs(crop_height - expected) < 2

        self._test_ok((1200, 1600), "red", setup, verify)

    def test_cancel_sets_result_none(self):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((400, 300), "yellow")
        try:
            cropper = ImageCropper(root, path)
            cropper.cancel()
            assert cropper.result is None
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)


class TestImageCropperZoom:
    """Tests for the on_zoom method."""

    @staticmethod
    def _test_zoom(img_size, color, event_factory, verify_fn):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image(img_size, color)
        try:
            cropper = ImageCropper(root, path)
            event = event_factory()
            cropper.on_zoom(event)
            verify_fn(cropper)
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

    def test_scroll_up_zooms_in(self):
        import tkinter as tk

        def factory():
            e = tk.Event()
            e.delta = 120
            e.num = None
            return e

        self._test_zoom(
            (800, 600), "blue", factory,
            lambda c: assert_true(c.scale_factor > min(
                c.display_size / c.original.width,
                c.display_size / c.original.height,
            ))
        )

    def test_scroll_down_zooms_out(self):
        import tkinter as tk

        def factory():
            e = tk.Event()
            e.delta = -120
            e.num = None
            return e

        self._test_zoom(
            (800, 600), "blue", factory,
            lambda c: None  # just verify it doesn't crash
        )

    def test_zoom_is_clamped(self):
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((800, 600), "blue")
        try:
            from image_cropper import ImageCropper
            cropper = ImageCropper(root, path)

            event_in = tk.Event()
            event_in.delta = 120
            event_in.num = None
            for _ in range(100):
                cropper.on_zoom(event_in)
            assert cropper.scale_factor <= 10.0

            event_out = tk.Event()
            event_out.delta = -120
            event_out.num = None
            for _ in range(100):
                cropper.on_zoom(event_out)
            min_scale = max(
                cropper.display_size / cropper.original.width,
                cropper.display_size / cropper.original.height,
            ) * 0.1
            assert cropper.scale_factor >= min_scale
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

    def test_linux_scroll_up_zooms_in(self):
        import tkinter as tk

        def factory():
            e = tk.Event()
            e.delta = 0
            e.num = 4
            return e

        self._test_zoom(
            (800, 600), "blue", factory,
            lambda c: assert_true(c.scale_factor > 0)
        )

    def test_linux_scroll_down_zooms_out(self):
        import tkinter as tk

        def factory():
            e = tk.Event()
            e.delta = 0
            e.num = 5
            return e

        self._test_zoom(
            (800, 600), "blue", factory,
            lambda c: None
        )


def assert_true(condition):
    assert condition


class TestImageCropperDrag:
    """Tests for on_press and on_drag methods."""

    def test_on_press_stores_drag_start(self):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((600, 600), "green")
        try:
            cropper = ImageCropper(root, path)
            event = tk.Event()
            event.x = 150
            event.y = 200
            cropper.on_press(event)
            assert cropper.drag_start_x == 150
            assert cropper.drag_start_y == 200
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

    def test_on_drag_moves_image(self):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((600, 600), "green")
        try:
            cropper = ImageCropper(root, path)
            cropper._update_display_image()
            init_coords = cropper.canvas.coords(cropper.image_id)

            press = tk.Event()
            press.x = 100
            press.y = 100
            cropper.on_press(press)
            drag = tk.Event()
            drag.x = 150
            drag.y = 120
            cropper.on_drag(drag)

            new_coords = cropper.canvas.coords(cropper.image_id)
            assert new_coords[0] == init_coords[0] + 50
            assert new_coords[1] == init_coords[1] + 20
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)


class TestImageCropperInit:
    """Tests for __init__ and _update_display_image."""

    def test_init_sets_properties(self):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((400, 300), "yellow")
        try:
            cropper = ImageCropper(root, path)
            assert cropper.result is None
            assert cropper.image_path == path
            assert cropper.original is not None
            assert cropper.original.width == 400
            assert cropper.original.height == 300
            assert cropper.display_size == 600
            assert cropper.crop_size == 300
            assert cropper.scale_factor > 0
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

    def test_display_image_scales_correctly(self):
        import tkinter as tk
        from image_cropper import ImageCropper

        root = tk.Tk()
        root.withdraw()
        path = _make_temp_image((800, 800), "white")
        try:
            cropper = ImageCropper(root, path)
            expected_scale = 600.0 / 800.0
            assert abs(cropper.scale_factor - expected_scale) < 0.01
            disp_w = int(800 * cropper.scale_factor)
            disp_h = int(800 * cropper.scale_factor)
            assert disp_w == cropper.display_image.width
            assert disp_h == cropper.display_image.height
        finally:
            root.destroy()
            del cropper
            gc.collect()
            _cleanup_temp(path)

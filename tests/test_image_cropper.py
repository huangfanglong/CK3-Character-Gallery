"""Comprehensive tests for the ImageCropper class.

Tests all original ImageCropper methods: __init__, _update_display_image,
on_press, on_drag, on_zoom, ok, cancel.

Uses a single session-scoped Tk root to avoid the Windows CI hang
that occurs when creating multiple Tk() instances in the same process.
"""

import os
import tempfile
import gc
import tkinter as tk

import pytest

from image_cropper import ImageCropper


def _make_temp_image(size=(600, 600), color="red"):
    """Create a temporary PNG image file and return its path."""
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


@pytest.fixture(scope="session")
def tk_root():
    """Session-scoped Tk root shared by all ImageCropper tests."""
    root = tk.Tk()
    root.withdraw()
    yield root
    root.destroy()


def _make_cropper(tk_root, img_size=(600, 600), color="red"):
    """Create an ImageCropper with a temp image. Returns (cropper, path)."""
    path = _make_temp_image(img_size, color)
    cropper = ImageCropper(tk_root, path)
    return cropper, path


def _cleanup(cropper, path):
    """Destroy the cropper window and delete the temp file."""
    if cropper and cropper.winfo_exists():
        cropper.destroy()
    del cropper
    gc.collect()
    _cleanup_temp(path)


def test_module_can_be_imported():
    assert ImageCropper is not None


class TestImageCropperOk:
    """Tests for the ok() coordinate math method."""

    def test_ok_default_center_crop(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(1200, 1600))
        try:
            cropper._update_display_image()
            center = cropper.display_size // 2
            cropper.canvas.coords(cropper.image_id, (center, center))
            cropper.ok()
            assert cropper.result is not None
            left, top, right, bottom = cropper.result
            crop_cx = (left + right) / 2
            crop_cy = (top + bottom) / 2
            assert abs(crop_cx - cropper.original.width / 2) < 2
            assert abs(crop_cy - cropper.original.height / 2) < 2
        finally:
            _cleanup(cropper, path)

    def test_ok_shifted_image_clamps_bounds(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(1200, 1600))
        try:
            cropper._update_display_image()
            cropper.canvas.coords(cropper.image_id, (0, 0))
            cropper.ok()
            assert cropper.result is not None
            left, top, right, bottom = cropper.result
            o_w, o_h = cropper.original.width, cropper.original.height
            assert 0 <= left <= o_w
            assert 0 <= right <= o_w
            assert 0 <= top <= o_h
            assert 0 <= bottom <= o_h
        finally:
            _cleanup(cropper, path)

    def test_ok_large_zoom(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(1200, 1600))
        try:
            cropper.scale_factor = 2.0
            cropper._update_display_image()
            center = cropper.display_size // 2
            cropper.canvas.coords(cropper.image_id, (center, center))
            cropper.ok()
            assert cropper.result is not None
            expected = cropper.crop_size / cropper.scale_factor
            assert abs((cropper.result[2] - cropper.result[0]) - expected) < 2
            assert abs((cropper.result[3] - cropper.result[1]) - expected) < 2
        finally:
            _cleanup(cropper, path)

    def test_cancel_sets_result_none(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(400, 300))
        try:
            cropper.cancel()
            assert cropper.result is None
        finally:
            _cleanup(cropper, path)


class TestImageCropperZoom:
    """Tests for the on_zoom method."""

    def test_scroll_up_zooms_in(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 600))
        try:
            original = cropper.scale_factor
            event = tk.Event()
            event.delta = 120
            event.num = None
            cropper.on_zoom(event)
            assert cropper.scale_factor > original
        finally:
            _cleanup(cropper, path)

    def test_scroll_down_zooms_out(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 600))
        try:
            cropper.scale_factor = 1.0
            original = cropper.scale_factor
            event = tk.Event()
            event.delta = -120
            event.num = None
            cropper.on_zoom(event)
            assert cropper.scale_factor < original
        finally:
            _cleanup(cropper, path)

    def test_zoom_is_clamped(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 600))
        try:
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
            _cleanup(cropper, path)

    def test_linux_scroll_up_zooms_in(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 600))
        try:
            original = cropper.scale_factor
            event = tk.Event()
            event.delta = 0
            event.num = 4
            cropper.on_zoom(event)
            assert cropper.scale_factor > original
        finally:
            _cleanup(cropper, path)

    def test_linux_scroll_down_zooms_out(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 600))
        try:
            cropper.scale_factor = 1.0
            original = cropper.scale_factor
            event = tk.Event()
            event.delta = 0
            event.num = 5
            cropper.on_zoom(event)
            assert cropper.scale_factor < original
        finally:
            _cleanup(cropper, path)


class TestImageCropperDrag:
    """Tests for on_press and on_drag methods."""

    def test_on_press_stores_drag_start(self, tk_root):
        cropper, path = _make_cropper(tk_root)
        try:
            event = tk.Event()
            event.x = 150
            event.y = 200
            cropper.on_press(event)
            assert cropper.drag_start_x == 150
            assert cropper.drag_start_y == 200
        finally:
            _cleanup(cropper, path)

    def test_on_drag_moves_image(self, tk_root):
        cropper, path = _make_cropper(tk_root)
        try:
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
            _cleanup(cropper, path)


class TestImageCropperInit:
    """Tests for __init__ and _update_display_image."""

    def test_init_sets_properties(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(400, 300), color="yellow")
        try:
            assert cropper.result is None
            assert cropper.image_path == path
            assert cropper.original is not None
            assert cropper.original.width == 400
            assert cropper.original.height == 300
            assert cropper.display_size == 600
            assert cropper.crop_size == 300
            assert cropper.scale_factor > 0
        finally:
            _cleanup(cropper, path)

    def test_display_image_scales_correctly(self, tk_root):
        cropper, path = _make_cropper(tk_root, img_size=(800, 800), color="white")
        try:
            expected_scale = 600.0 / 800.0
            assert abs(cropper.scale_factor - expected_scale) < 0.01
            disp_w = int(800 * cropper.scale_factor)
            disp_h = int(800 * cropper.scale_factor)
            assert disp_w == cropper.display_image.width
            assert disp_h == cropper.display_image.height
        finally:
            _cleanup(cropper, path)

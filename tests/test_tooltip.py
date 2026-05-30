"""Tests for the ToolTip class."""

from tooltip import ToolTip


def test_tooltip_attaches_without_error(tk_root):
    """ToolTip can be attached to a widget without raising."""
    import tkinter as tk
    btn = tk.Button(tk_root, text="Test")
    tip = ToolTip(btn, "Hello")
    assert tip is not None
    assert tip.text == "Hello"


def test_tooltip_schedule_and_cancel(tk_root):
    """_schedule sets up a delayed show; _hide cancels it."""
    import tkinter as tk
    btn = tk.Button(tk_root, text="Test")
    tip = ToolTip(btn, "Test hint", delay_ms=10)

    assert tip._tip is None
    tip._schedule()
    assert tip._after_id is not None

    tip._hide()
    assert tip._tip is None


def test_tooltip_show_then_hide(tk_root):
    """_show creates a Toplevel; _hide destroys it."""
    import tkinter as tk
    btn = tk.Button(tk_root, text="Test")
    btn.pack()
    tk_root.update_idletasks()
    tip = ToolTip(btn, "Test hint", delay_ms=10)

    tip._show()
    assert tip._tip is not None
    assert tip._tip.winfo_exists()

    tip._hide()
    assert tip._tip is None


def test_tooltip_imported_in_gallery_ui():
    """ToolTip is importable from gallery_ui."""
    from gallery_ui import ToolTip as T  # noqa: F401
    assert T is ToolTip

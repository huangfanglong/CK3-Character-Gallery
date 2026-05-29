"""Themed dialog boxes replacing tkinter's native Windows dialogs.

All dialogs use ttk widgets styled by sv_ttk's dark theme for a
consistent modern appearance.
"""

import tkinter as tk
from tkinter import ttk


class _BaseDialog(tk.Toplevel):
    """Base class for themed modal dialogs."""

    def __init__(self, parent, title: str) -> None:
        super().__init__(parent)
        self.title(title)
        self.transient(parent)
        self.grab_set()
        self.resizable(False, False)
        self.configure(bg="#1c1c1c")
        self.result: bool | str | None = None
        # Center on parent
        self.update_idletasks()
        pw, ph = parent.winfo_width(), parent.winfo_height()
        px, py = parent.winfo_rootx(), parent.winfo_rooty()
        w, h = self.winfo_width(), self.winfo_height()
        self.geometry(f"+{px + (pw - w) // 2}+{py + (ph - h) // 2}")


def ask_string(parent, title: str, prompt: str) -> str | None:
    """Show a themed input dialog. Returns the string or None if cancelled."""
    dlg = _BaseDialog(parent, title)
    dlg.result = None

    ttk.Label(dlg, text=prompt, wraplength=300).pack(padx=20, pady=(20, 5))
    entry = ttk.Entry(dlg, width=35)
    entry.pack(padx=20, pady=(0, 10))
    entry.focus_set()

    btn_frame = ttk.Frame(dlg)
    btn_frame.pack(pady=(0, 15))
    ttk.Button(btn_frame, text="OK", command=lambda: _ok(dlg, entry), width=10).pack(side="left", padx=5)
    ttk.Button(btn_frame, text="Cancel", command=dlg.destroy, width=10).pack(side="left", padx=5)

    entry.bind("<Return>", lambda e: _ok(dlg, entry))
    entry.bind("<Escape>", lambda e: dlg.destroy())

    dlg.wait_window()
    return dlg.result


def _ok(dlg: _BaseDialog, entry: ttk.Entry) -> None:
    dlg.result = entry.get().strip() or None
    dlg.destroy()


def _message_box(parent, title: str, message: str, kind: str) -> None:
    """Show a themed info/warning/error dialog."""
    icons = {"info": "\u2139", "warning": "\u26a0", "error": "\u2716"}
    dlg = _BaseDialog(parent, title)
    frm = ttk.Frame(dlg)
    frm.pack(padx=25, pady=(20, 10))
    ttk.Label(frm, text=icons.get(kind, ""), font=("Segoe UI", 20)).pack(side="left", padx=(0, 12))
    ttk.Label(frm, text=message, wraplength=320).pack(side="left")
    ttk.Button(dlg, text="OK", command=dlg.destroy, width=10).pack(pady=(0, 15))
    dlg.wait_window()


def show_info(parent, title: str, message: str) -> None:
    _message_box(parent, title, message, "info")


def show_warning(parent, title: str, message: str) -> None:
    _message_box(parent, title, message, "warning")


def show_error(parent, title: str, message: str) -> None:
    _message_box(parent, title, message, "error")


def _ask_buttons(parent, title: str, message: str, buttons: list[tuple[str, bool | None]]) -> bool | None:
    """Show a themed yes/no/cancel dialog. Returns True, False, or None."""
    dlg = _BaseDialog(parent, title)
    dlg.result = None

    ttk.Label(dlg, text=message, wraplength=320).pack(padx=25, pady=(20, 10))
    btn_frame = ttk.Frame(dlg)
    btn_frame.pack(pady=(0, 15))
    for text, value in buttons:
        ttk.Button(
            btn_frame, text=text, width=12,
            command=lambda v=value: _set_result(dlg, v),  # type: ignore[misc]
        ).pack(side="left", padx=5)
    dlg.wait_window()
    return dlg.result


def _set_result(dlg: _BaseDialog, value: bool | None) -> None:
    dlg.result = value
    dlg.destroy()


def ask_yesno(parent, title: str, message: str) -> bool:
    result = _ask_buttons(parent, title, message, [("Yes", True), ("No", False)])
    return bool(result)


def ask_yesnocancel(parent, title: str, message: str) -> bool | None:
    return _ask_buttons(parent, title, message, [("Yes", True), ("No", False), ("Cancel", None)])

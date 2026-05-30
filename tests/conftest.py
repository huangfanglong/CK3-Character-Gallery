"""Pytest configuration for the CK3 Character Gallery test suite.

Adds the project root to sys.path so tests can import source modules directly
without fragile relative-path manipulation in each test file.
"""

import os
import sys
import tkinter as tk

import pytest

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


@pytest.fixture(scope="session")
def tk_root():
    """Session-scoped Tk root shared by all tests that need one."""
    root = tk.Tk()
    root.withdraw()
    yield root
    root.destroy()

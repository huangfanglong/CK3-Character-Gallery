"""Pytest configuration for the CK3 Character Gallery test suite.

Adds the project root to sys.path so tests can import source modules directly
without fragile relative-path manipulation in each test file.
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

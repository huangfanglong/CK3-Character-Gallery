"""Utility functions for the CK3 Character Gallery application."""

import re


def homogenize_dna(text: str) -> str:
    """Duplicate the first gene value into the second position in CK3 DNA gene entries.

    In CK3 DNA strings, each gene line typically has the format::

        gene_name = { "value" count "value" count }

    This function copies the first
    value into the second position so both alleles are identical.

    Args:
        text: The raw DNA string to process.

    Returns:
        The DNA string with gene values homogenised.
    """
    pattern = re.compile(
        r'^(\s*[\w_]+\s*=\s*\{\s*)("[^"]+"|\d+)\s+(\d+)\s+("[^"]+"|\d+)\s+(\d+)\s*(\})',
        re.MULTILINE,
    )

    def repl(m: re.Match[str]) -> str:
        return f"{m.group(1)}{m.group(2)} {m.group(3)} {m.group(2)} {m.group(3)} {m.group(6)}"

    return pattern.sub(repl, text)

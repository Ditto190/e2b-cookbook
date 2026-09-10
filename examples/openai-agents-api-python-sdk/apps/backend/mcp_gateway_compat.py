"""Repair remote catalog entries in older E2B gateway images."""
from __future__ import annotations

from pathlib import Path
import re


def update_catalog(source: str) -> str:
    def update(match: re.Match[str]) -> str:
        entry = match.group()
        if 'https://mcp.deepwiki.com/sse' not in entry:
            return entry
        return entry.replace('transport_type: sse', 'transport_type: streamable-http').replace(
            'https://mcp.deepwiki.com/sse', 'https://mcp.deepwiki.com/mcp'
        )

    source = re.sub(r'(?ms)^  deepwiki:\n.*?(?=^  \S|\Z)', update, source)

    def context7(match: re.Match[str]) -> str:
        # The SDK exposes Context7 without credential options. The gateway
        # sends this unresolved catalog placeholder literally, which Context7
        # rejects as an invalid key. Omitting it enables anonymous access.
        return match.group().replace(
            '      headers:\n        CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}"\n', ''
        )

    return re.sub(r'(?ms)^  context7:\n.*?(?=^  \S|\Z)', context7, source)


if __name__ == '__main__':
    catalog = Path('/etc/mcp-gateway/docker-catalog.yaml')
    original = catalog.read_text()
    updated = update_catalog(original)
    if updated != original:
        catalog.write_text(updated)

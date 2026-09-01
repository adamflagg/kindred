"""harden-runner egress allowlists must pair the two Go module endpoints.

`egress-policy: block` means an endpoint absent from the list is refused, and
the refusal surfaces as a build error a long way from its cause. Fetching a Go
module needs BOTH `proxy.golang.org` (serves it) and `sum.golang.org` (verifies
it against the checksum database). Allowing only the first works right up until
something actually has to be verified.

Measured: kindred#2629 moved `pocketbase/go.mod` to `go 1.27` while the builder
image ships Go 1.26, so `GOTOOLCHAIN=auto` correctly downloaded the 1.27
toolchain -- and the CD build died verifying it:

    go: download go1.27.0: golang.org/toolchain@v0.0.1-go1.27.0.linux-amd64:
      verifying module: Get "https://sum.golang.org/lookup/...":
      dial tcp 54.185.253.63:443: connect: connection refused

Both Go images failed to build and main became undeployable. Every one of the
seven cd.yml allowlists had `proxy.golang.org` and none had `sum.golang.org`,
so the same trap was set in six other jobs.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[3]
WORKFLOWS = sorted((REPO_ROOT / ".github/workflows").glob("*.yml"))

PROXY = "proxy.golang.org:443"
SUM = "sum.golang.org:443"


def _allowlist_blocks(text: str) -> list[str]:
    """Each `allowed-endpoints: >` folded block, as raw text.

    Parsing the YAML would collapse the folded scalar into one string and lose
    which block is which; the blocks are what the assertion is about.
    """
    blocks = []
    for m in re.finditer(r"allowed-endpoints:\s*>\n((?:\s+\S+:\d+\n)+)", text):
        blocks.append(m.group(1))
    return blocks


@pytest.mark.parametrize("workflow", WORKFLOWS, ids=lambda p: p.name)
def test_go_proxy_and_checksum_endpoints_are_allowed_together(workflow: Path) -> None:
    text = workflow.read_text()
    for i, block in enumerate(_allowlist_blocks(text)):
        if PROXY in block:
            assert SUM in block, (
                f"{workflow.name} allowlist #{i + 1} permits {PROXY} but not {SUM}; "
                "a Go toolchain or module download will fail verification"
            )


def test_the_image_building_job_allows_both() -> None:
    """Named explicitly: this is the job kindred#2629 actually broke."""
    text = (REPO_ROOT / ".github/workflows/cd.yml").read_text()
    blocks = [b for b in _allowlist_blocks(text) if PROXY in b]
    assert blocks, "no cd.yml allowlist mentions the Go module proxy any more"
    assert all(SUM in b for b in blocks)

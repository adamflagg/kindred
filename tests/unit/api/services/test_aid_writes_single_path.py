"""Every Camperships write goes through commit_aid_writes, so the post-commit listener sees all of them.

The season cache is invalidated from that listener. A write that bypasses it (a raw SDK create/update/delete,
a raw `send`, a direct `send_batch`) would leave a stale season on screen with nothing to clear it. This scan
fails the build on such a write instead of leaving the cache to be wrong in production.

`record_change` is the one sanctioned exception, and only for its one caller: it writes a log-only
aid_change_log row, outside commit_aid_writes. Its caller (FinancialAidRulesRepository.record) writes only
aid_rules_effect rows, which no season read consumes, and runs right after the approval's own
commit_aid_writes. Any other use of it would write behind the listener's back, so the scan pins it to those
two files.
"""

import ast
import re
from pathlib import Path

import api.constants.collections as collection_constants

REPO_ROOT = Path(__file__).resolve().parents[4]
SCAN_ROOTS = ("api", "bunking/financial_aid")
COMMIT_PATH = "bunking/financial_aid/change_log.py"
RECORD_CHANGE_FILES = {COMMIT_PATH, "api/services/financial_aid_rules_service.py"}

_WRITE_ATTRS = {"create", "update", "delete"}
_COLLECTION_PATH = re.compile(r"/api/collections/([^/?{}]*)")


def _module_strings(tree: ast.Module) -> dict[str, str]:
    found = {
        name: value
        for name, value in vars(collection_constants).items()
        if isinstance(value, str) and not name.startswith("_")
    }
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            found[node.targets[0].id] = node.value.value
    return found


def _resolve(node: ast.expr | None, names: dict[str, str]) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.Attribute):
        return names.get(node.attr)
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for piece in node.values:
            if isinstance(piece, ast.Constant):
                parts.append(str(piece.value))
            elif isinstance(piece, ast.FormattedValue):
                parts.append(_resolve(piece.value, names) or "{}")
        return "".join(parts)
    return None


def _is_aid_collection(name: str | None) -> bool:
    return name is not None and (name.startswith(("aid_", "financial_aid")) or "grant" in name)


def _collection_of(call: ast.expr, names: dict[str, str]) -> str | None:
    """The collection a `pb.collection(X)` / `aid_collection(pb, X)` call is built from."""
    if not isinstance(call, ast.Call):
        return None
    func = call.func
    if isinstance(func, ast.Attribute) and func.attr == "collection" and call.args:
        return _resolve(call.args[0], names)
    if isinstance(func, ast.Name) and func.id == "aid_collection" and len(call.args) >= 2:
        return _resolve(call.args[1], names)
    return None


def _bound_collections(tree: ast.Module, names: dict[str, str]) -> dict[str, str]:
    """`coll = pb.collection(X)` -> {"coll": X}, so `coll.create(...)` is seen too."""
    bound: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            resolved = _collection_of(node.value, names)
            if resolved:
                bound[node.targets[0].id] = resolved
    return bound


def _send_is_aid_write(call: ast.Call, names: dict[str, str]) -> bool:
    path = _resolve(call.args[0], names) if call.args else None
    match = _COLLECTION_PATH.search(path or "")
    if not match or not _is_aid_collection(match.group(1)):
        return False
    config = call.args[1] if len(call.args) > 1 else None
    if config is None:
        return False  # the client's default method is GET
    if isinstance(config, ast.Dict):
        for key, value in zip(config.keys, config.values, strict=True):
            if isinstance(key, ast.Constant) and key.value == "method":
                method = _resolve(value, names)
                return method is None or method.upper() != "GET"
        return False
    return True  # a config built elsewhere: assume it can write


def scan_source(source: str, rel_path: str) -> list[str]:
    """Every write in ``source`` that bypasses commit_aid_writes, as ``path:line: what``."""
    tree = ast.parse(source)
    names = _module_strings(tree)
    bound = _bound_collections(tree, names)
    in_commit_module = rel_path == COMMIT_PATH
    hits: list[str] = []
    for node in ast.walk(tree):
        where = f"{rel_path}:{getattr(node, 'lineno', 0)}"
        if isinstance(node, ast.Attribute) and node.attr in _WRITE_ATTRS and not in_commit_module:
            target = _collection_of(node.value, names)
            if target is None and isinstance(node.value, ast.Name):
                target = bound.get(node.value.id)
            if _is_aid_collection(target):
                hits.append(f"{where}: .{node.attr} on collection {target!r}")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "send":
            if not in_commit_module and _send_is_aid_write(node, names):
                hits.append(f"{where}: raw send to an aid collection")
        if not in_commit_module:
            if isinstance(node, ast.Name | ast.Attribute):
                used = node.id if isinstance(node, ast.Name) else node.attr
                if used == "send_batch":
                    hits.append(f"{where}: send_batch outside change_log")
            elif isinstance(node, ast.ImportFrom) and any(a.name == "send_batch" for a in node.names):
                hits.append(f"{where}: send_batch imported outside change_log")
        if rel_path not in RECORD_CHANGE_FILES:
            if (isinstance(node, ast.Name) and node.id == "record_change") or (
                isinstance(node, ast.Attribute) and node.attr == "record_change"
            ):
                hits.append(f"{where}: record_change used outside its sanctioned caller")
            elif isinstance(node, ast.ImportFrom) and any(a.name == "record_change" for a in node.names):
                hits.append(f"{where}: record_change imported outside its sanctioned caller")
    return hits


def _scanned_files() -> list[Path]:
    files = sorted(p for root in SCAN_ROOTS for p in (REPO_ROOT / root).rglob("*.py"))
    assert files, f"no .py files under {SCAN_ROOTS}: the scan would pass vacuously"
    return files


def test_no_aid_write_bypasses_commit_aid_writes() -> None:
    hits: list[str] = []
    for path in _scanned_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        hits.extend(scan_source(path.read_text(), rel))
    assert not hits, "writes outside commit_aid_writes (its listener would never hear of them):\n" + "\n".join(hits)


def test_the_scan_covers_the_files_that_matter() -> None:
    rel = {p.relative_to(REPO_ROOT).as_posix() for p in _scanned_files()}
    assert COMMIT_PATH in rel
    assert "api/services/financial_aid_rules_service.py" in rel
    assert len(rel) > 50


def test_the_scanner_detects_each_kind_of_bypass() -> None:
    """Without this the guard could pass on a tree where it matches nothing at all."""
    cases = {
        "pb.collection(AID_REQUESTS).create({})": 1,
        'pb.collection("aid_requests").update("x", {})': 1,
        "await asyncio.to_thread(pb.collection(AID_GRANTS).delete, rid)": 1,
        "aid_collection(pb, AID_DECISIONS).create({})": 1,
        'pb.collection("financial_aid_applications").update("x", {})': 1,
        'c = pb.collection("aid_postings")\nc.delete("x")': 1,
        'LOCAL = "aid_sources"\npb.collection(LOCAL).create({})': 1,
        'pb.send("/api/collections/aid_requests/records", {"method": "POST"})': 1,
        'pb.send(f"/api/collections/aid_requests/records/{rid}", {"method": "DELETE"})': 1,
        "send_batch(pb, reqs)": 1,
        "from bunking.pocketbase_batch import send_batch": 1,
        "record_change(pb, entity='x')": 1,
        "from bunking.financial_aid.change_log import record_change": 1,
    }
    for source, expected in cases.items():
        assert len(scan_source(source, "api/services/x.py")) == expected, source


def test_the_scanner_lets_legitimate_code_through() -> None:
    clean = [
        "pb.collection(PERSONS).create({})",
        'pb.collection("bunks").update("x", {})',
        "pb.collection(AID_REQUESTS).get_full_list()",
        'pb.send("/api/collections/aid_requests/records", {"method": "GET"})',
        'pb.send("/api/collections/aid_requests/records")',
        'pb.send("/api/collections/persons/records", {"method": "POST"})',
        "pb.send(path, config)",
        "pb.collection(target_collection).delete(x)",
        "commit_aid_writes(pb, writes, actor=a)",
    ]
    for source in clean:
        assert scan_source(source, "api/services/x.py") == [], source
    assert scan_source("record_change(pb)", "api/services/financial_aid_rules_service.py") == []
    assert scan_source("pb.collection(AID_REQUESTS).create({})\nsend_batch(pb, r)", COMMIT_PATH) == []

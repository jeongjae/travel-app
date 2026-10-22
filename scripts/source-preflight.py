"""Read-only P-07 source inventory. Git tree identity is not a content SHA-256 audit."""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path, PurePosixPath


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    if Path(path).stat().st_size > 16 * 1024 ** 2:
        raise ValueError("inventory JSON limit")
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs)


def safe_path(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError("unsafe source path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in (".", "..", "") for p in value.split("/")):
        raise ValueError("unsafe source path")
    return path


def inventory(tree, expected_commit, selected=(), source_root=None):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit) or tree.get("sha") != expected_commit:
        raise ValueError("source commit mismatch")
    if tree.get("truncated") is not False or not isinstance(tree.get("tree"), list):
        raise ValueError("complete recursive tree required")
    selected = set(selected)
    for path in selected:
        safe_path(path)
    root = Path(source_root).resolve(strict=True) if source_root else None
    records, seen, counts, sizes = [], set(), Counter(), Counter()
    for entry in tree["tree"]:
        path = entry.get("path")
        safe_path(path)
        if path.casefold() in seen:
            raise ValueError("duplicate/case-colliding source path")
        seen.add(path.casefold())
        if entry.get("type") == "tree":
            continue
        if entry.get("type") != "blob" or entry.get("mode") not in ("100644", "100755"):
            raise ValueError("source link/submodule requires separate review")
        size, git_hash = entry.get("size"), entry.get("sha")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0 or not re.fullmatch(r"[0-9a-f]{40}", git_hash or ""):
            raise ValueError("invalid source size/hash")
        top = path.split("/")[0] if "/" in path else "(root)"
        counts[top] += 1
        sizes[top] += size
        record = {"sourceKey": path, "gitBlobSha1": git_hash, "byteLength": size,
                  "selected": path in selected, "contentCheck": "not-read",
                  "migrationDisposition": "unreviewed"}
        if path in selected and root:
            local = root.joinpath(*PurePosixPath(path).parts)
            if not local.resolve(strict=True).is_relative_to(root) or any(p.is_symlink() for p in [local, *list(local.parents)[:len(PurePosixPath(path).parts)-1]]):
                raise ValueError("source leaves root or is symlink")
            sha256, blob_sha = hashlib.sha256(), hashlib.sha1(f"blob {size}\0".encode())
            count = 0
            with local.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    count += len(chunk)
                    if count > size:
                        raise ValueError("source grew during read")
                    sha256.update(chunk)
                    blob_sha.update(chunk)
            if count != size or blob_sha.hexdigest() != git_hash:
                raise ValueError("local source bytes differ from pinned Git blob")
            # Re-read to detect a concurrent source edit without executing any source module.
            again = hashlib.sha256()
            with local.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    again.update(chunk)
            if again.digest() != sha256.digest():
                raise ValueError("source changed during audit")
            record.update(sha256=sha256.hexdigest(), contentCheck="verified-local-bytes")
        records.append(record)
    if selected - {r["sourceKey"] for r in records}:
        raise ValueError("selected source file missing from tree")
    return {"format": "travel-app-source-preflight", "version": 1, "sourceCommit": expected_commit,
            "summary": {"files": len(records), "bytes": sum(sizes.values()),
                        "selected": len(selected), "localBytesVerified": sum(r["contentCheck"] == "verified-local-bytes" for r in records),
                        "byRoot": {key: {"files": counts[key], "bytes": sizes[key]} for key in sorted(counts)}},
            "warnings": ["tree metadata is not full extraction, reference closure, display parity, rights approval or device verification",
                         "all migration dispositions remain unreviewed; no source is automatically excluded"],
            "records": records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--selection", help="JSON array of source-relative file paths")
    parser.add_argument("--source-root")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    selected = load_json(args.selection) if args.selection else []
    if not isinstance(selected, list) or not all(isinstance(p, str) for p in selected) or len(selected) != len(set(selected)):
        raise ValueError("selection must be a unique path array")
    output = Path(args.output).resolve()
    if args.source_root and output.is_relative_to(Path(args.source_root).resolve()):
        raise ValueError("output must be outside the read-only source")
    report = inventory(load_json(args.tree), args.expected_commit, selected, args.source_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()

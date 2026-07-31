"""Repo consistency checks, run by CI and locally: python .github/checks.py"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = []


def fail(msg):
    failures.append(msg)
    print(f"FAIL  {msg}")


def ok(msg):
    print(f"ok    {msg}")


# 1. Plugin and marketplace manifests parse and carry required fields
for rel, required in [
    (".claude-plugin/plugin.json", ["name", "description", "version"]),
    (".claude-plugin/marketplace.json", ["name", "owner", "plugins"]),
]:
    path = os.path.join(ROOT, rel)
    try:
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        missing = [k for k in required if k not in data]
        if missing:
            fail(f"{rel}: missing fields {missing}")
        else:
            ok(f"{rel} valid")
    except Exception as e:
        fail(f"{rel}: {e}")

# 2. Plugin and marketplace versions agree
try:
    with io.open(os.path.join(ROOT, ".claude-plugin/plugin.json"), encoding="utf-8") as f:
        pv = json.load(f)["version"]
    with io.open(os.path.join(ROOT, ".claude-plugin/marketplace.json"), encoding="utf-8") as f:
        mv = json.load(f)["plugins"][0]["version"]
    if pv != mv:
        fail(f"version mismatch: plugin.json {pv} vs marketplace.json {mv}")
    else:
        ok(f"versions agree ({pv})")
except Exception as e:
    fail(f"version check: {e}")

# 3. All skills exist with frontmatter name + description
for skill in ["think", "act", "prove", "onboard"]:
    path = os.path.join(ROOT, "skills", skill, "SKILL.md")
    try:
        with io.open(path, encoding="utf-8") as f:
            head = f.read(2000)
        if not head.startswith("---") or f"name: {skill}" not in head or "description:" not in head:
            fail(f"skills/{skill}/SKILL.md: frontmatter missing name/description")
        else:
            m = re.search(r"^description: (.+)$", head, re.M)
            if m and not m.group(1).startswith(('"', "'")) and ": " in m.group(1):
                fail(f"skills/{skill}/SKILL.md: unquoted colon inside description breaks YAML")
            else:
                ok(f"skills/{skill}/SKILL.md frontmatter valid")
    except Exception as e:
        fail(f"skills/{skill}/SKILL.md: {e}")

# 4. Domain adapters all carry a binding minimum evidence set and a fraud table
domains_dir = os.path.join(ROOT, "skills", "think", "references", "domains")
for name in sorted(os.listdir(domains_dir)):
    with io.open(os.path.join(domains_dir, name), encoding="utf-8") as f:
        body = f.read()
    if "Minimum evidence set" not in body or "Fraud table" not in body:
        fail(f"domains/{name}: missing minimum evidence set or fraud table")
    else:
        ok(f"domains/{name} complete")

# 5. Evidence files parse as JSON
results_dir = os.path.join(ROOT, "eval", "results")
for name in sorted(os.listdir(results_dir)):
    try:
        with io.open(os.path.join(results_dir, name), encoding="utf-8") as f:
            json.load(f)
        ok(f"eval/results/{name} parses")
    except Exception as e:
        fail(f"eval/results/{name}: {e}")

# 6. No em or en dashes anywhere (repo style rule)
dash = re.compile(chr(0x2014) + "|" + chr(0x2013))
count = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in (".git", "temp")]
    for f in files:
        extensionless_dirs = root.endswith(("/bin", "/.githooks")) or f == "pre-commit"
        if not (f.endswith((".md", ".js", ".json", ".py", ".sh", ".ps1", ".yml", ".csv")) or extensionless_dirs):
            continue
        p = os.path.join(root, f)
        try:
            with io.open(p, encoding="utf-8") as fh:
                if dash.search(fh.read()):
                    fail(f"em/en dash in {os.path.relpath(p, ROOT)}")
                    count += 1
        except Exception:
            pass
if count == 0:
    ok("no em/en dashes anywhere")

# 7. Every scenario directory is non-empty
scen_dir = os.path.join(ROOT, "eval", "scenarios")
for name in sorted(os.listdir(scen_dir)):
    entries = os.listdir(os.path.join(scen_dir, name))
    if not entries:
        fail(f"eval/scenarios/{name} is empty")
    else:
        ok(f"eval/scenarios/{name} ({len(entries)} entries)")

# 8. Decision registers: every id cited in an interface SSOT resolves, and no entry is uncited.
# Runs over every binding in the repo that carries a Document roles slot, this repo's own and
# every eval fixture's. A role left unbound is reported as skipped with its reason, never
# silently passed: an unbound role degrades, it does not disappear.
ROLE_ROW = re.compile(r"^\|\s*(decision register|interface ssot)\s*\|\s*([^|]*?)\s*\|", re.M | re.I)
ENTRY_ROW = re.compile(r"^\|\s*(D\d+)\s*\|", re.M)
FENCE = re.compile(r"```.*?```", re.S)
ID_REF = re.compile(r"\bD\d+\b")
MD_LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")

# Only the dangling direction is a defect. A register legitimately holds product and process
# decisions an interface SSOT never cites: s11's D5 is deliberately absent from its spine, which
# is that fixture's whole design. Failing on uncited entries would force the artifact to be bent
# to satisfy the check, which is the fraud this repo hunts, run backwards.


def read_text(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def role_path(repo_root, value):
    """Resolve a Document roles cell. Returns None when unbound, or (path, reason):
    reason is None when the path is a usable file."""
    value = value.strip().strip("`\"'")
    m = MD_LINK.search(value)
    if m:
        value = m.group(1).strip()
    if not value or value.lower().startswith(("unbound", "none", "<")):
        return None
    token = value.split()[0].strip("`\"'")
    candidate = os.path.normpath(os.path.join(repo_root, token))
    if not candidate.startswith(os.path.realpath(ROOT)) and not candidate.startswith(ROOT):
        return (token, "escapes the repository")
    if os.path.isdir(candidate):
        return (token, "is a directory, expected a file")
    if not os.path.isfile(candidate):
        return (token, "does not exist")
    return (candidate, None)


bindings = []
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "temp", "__pycache__")]
    if "PROCESS.md" in files and os.path.basename(root) == "docs":
        p = os.path.join(root, "PROCESS.md")
        try:
            text = read_text(p)
        except Exception as e:
            fail(f"{os.path.relpath(p, ROOT)}: unreadable ({e})")
            continue
        if text.lstrip("﻿ \t\r\n").startswith("# Process binding"):
            bindings.append((os.path.dirname(root), p, FENCE.sub("", text)))

for repo_root, binding_path, text in sorted(bindings):
    label = os.path.relpath(binding_path, ROOT)
    roles = {m.group(1).lower(): m.group(2) for m in ROLE_ROW.finditer(text)}
    if not roles:
        ok(f"{label}: no Document roles table, register check not applicable")
        continue
    resolved, unbound, broken = {}, [], []
    for role in ("decision register", "interface ssot"):
        if role not in roles:
            unbound.append(f"{role} (no row)")
            continue
        outcome = role_path(repo_root, roles[role])
        if outcome is None:
            unbound.append(role)
        elif outcome[1]:
            broken.append(f"{role} -> {outcome[0]} ({outcome[1]})")
        else:
            resolved[role] = outcome[0]
    for b in broken:
        fail(f"{label}: bound path unusable: {b}")
    if len(resolved) < 2:
        if not broken:
            ok(f"{label}: register check skipped, unbound: {', '.join(unbound)}")
        continue
    try:
        entries = set(ENTRY_ROW.findall(read_text(resolved["decision register"])))
        cited = set(ID_REF.findall(FENCE.sub("", read_text(resolved["interface ssot"]))))
    except Exception as e:
        fail(f"{label}: could not read a bound document ({e})")
        continue
    dangling = sorted(cited - entries, key=lambda s: int(s[1:]))
    if dangling:
        fail(f"{label}: SSOT cites {', '.join(dangling)} with no register entry")
    else:
        register_only = len(entries - cited)
        note = f", {register_only} register-only" if register_only else ""
        ok(f"{label}: {len(cited)} decision ids cited, all resolve{note}")

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all checks passed")

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
ROLE_ROW = re.compile(r"^\|\s*(Decision register|Interface SSOT)\s*\|\s*([^|]+?)\s*\|", re.M)
ENTRY_ROW = re.compile(r"^\|\s*(D\d+)\s*\|", re.M)
FENCE = re.compile(r"```.*?```", re.S)
ID_REF = re.compile(r"\bD\d+\b")


def role_path(repo_root, value):
    """Resolve a Document roles cell to a file, or None when unbound. Cells may carry a
    trailing qualifier such as 'docs/PRD.md section 4'; the file is the first token."""
    value = value.strip()
    if value.lower().startswith("unbound") or value.lower() == "none":
        return None
    token = value.split()[0].strip("`")
    candidate = os.path.join(repo_root, token)
    return candidate if os.path.isfile(candidate) else False


bindings = []
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "temp", "__pycache__")]
    if "PROCESS.md" in files and os.path.basename(root) == "docs":
        p = os.path.join(root, "PROCESS.md")
        with io.open(p, encoding="utf-8") as fh:
            text = fh.read()
        if text.startswith("# Process binding"):
            bindings.append((os.path.dirname(root), p, text))

for repo_root, binding_path, text in sorted(bindings):
    label = os.path.relpath(binding_path, ROOT)
    roles = {m.group(1): m.group(2) for m in ROLE_ROW.finditer(text)}
    if not roles:
        continue
    resolved, unbound, missing = {}, [], []
    for role in ("Decision register", "Interface SSOT"):
        if role not in roles:
            unbound.append(f"{role} (no row)")
            continue
        path = role_path(repo_root, roles[role])
        if path is None:
            unbound.append(role)
        elif path is False:
            missing.append(f"{role} -> {roles[role].strip()}")
        else:
            resolved[role] = path
    for m in missing:
        fail(f"{label}: bound path does not exist: {m}")
    if len(resolved) < 2:
        if not missing:
            ok(f"{label}: register check skipped, unbound: {', '.join(unbound)}")
        continue
    with io.open(resolved["Decision register"], encoding="utf-8") as fh:
        entries = set(ENTRY_ROW.findall(fh.read()))
    with io.open(resolved["Interface SSOT"], encoding="utf-8") as fh:
        cited = set(ID_REF.findall(FENCE.sub("", fh.read())))
    dangling = sorted(cited - entries)
    uncited = sorted(entries - cited)
    if dangling:
        fail(f"{label}: SSOT cites {', '.join(dangling)} with no register entry")
    if uncited:
        fail(f"{label}: register entries never cited by the SSOT: {', '.join(uncited)}")
    if not dangling and not uncited:
        ok(f"{label}: {len(entries)} decision ids, register and SSOT agree")

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all checks passed")

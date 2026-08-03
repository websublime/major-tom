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

# 3. All skills exist with frontmatter name + description.
# The skill list is DISCOVERED, never hardcoded. The hardcoded version passed on the commit that
# added a fifth skill: the new skill was simply not in the list, so nothing checked its frontmatter
# and the check still printed four green lines. A check that reports success on a surface it does
# not read is the exact class this repo hunts, so the surface defines the list.
SKILLS = sorted(
    d
    for d in os.listdir(os.path.join(ROOT, "skills"))
    if os.path.isdir(os.path.join(ROOT, "skills", d))
)
if not SKILLS:
    fail("skills/: no skill directories found, so check 3 would have been vacuous")
for skill in SKILLS:
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

# 4. Domain adapters all carry a binding minimum evidence set and a fraud table, AND are routed to.
# The second half was missing: this check read every adapter's contents and never checked that
# anything points at one. An adapter think's routing sentence does not name is never opened, so it
# is dead weight that still passes. Slug separators are matched loosely because the sentence writes
# them as prose ("business/ops" for business-ops, "design contracts" for design-contracts).
domains_dir = os.path.join(ROOT, "skills", "think", "references", "domains")
# Scope the search to the routing SENTENCE, not the whole file. The first version searched all of
# think's SKILL.md and was already vacuous on landing day: removing `research/reporting` from the
# routing sentence still passed, because "Research is never optional" sits in the same file. That is
# the class this file removed from the register check in commit 2d1eedd, three commits before this
# check landed, committed again here.
with io.open(os.path.join(ROOT, "skills", "think", "SKILL.md"), encoding="utf-8") as f:
    _think = f.read()
# The CLAUSE, not the paragraph: scoping to the paragraph was still vacuous, because the same
# paragraph carries "Research is never optional" and "education content uses research".
_m = re.search(r"If the task is(.*?)read the matching file", _think, re.S)
if not _m:
    # One cause, one failure. Reporting the missing clause AND every adapter as unrouted produced
    # nine failures for a single edit, which a gate flagged as noise that hides the real cause.
    fail("skills/think/SKILL.md: no domain routing clause, so no adapter can be checked as routed")
else:
    # Whole ENTRIES, not substrings. The substring match let a future adapter named `ops.md` pass by
    # matching "business/ops", measured by a gate. Entries are comma or "or" separated, a
    # gloss is removed before splitting, and the slug must equal an entry or its first segment, so
    # `research.md` still matches "research/reporting" while `ops.md` matches nothing. Residual,
    # measured: a slug equal to an entry's FIRST segment still counts, so a hypothetical
    # `design.md` would match "design/UX". That name is ambiguous next to the two design
    # adapters that exist, so the residual is left rather than special-cased.
    def _norm(entry):
        return re.sub(r"[ /-]+", "-", entry.strip(" .*`\n").lower())

    # Glosses are removed BEFORE splitting. Splitting first let a gloss containing commas leak its
    # fragments in as entries: a gate measured `a`, `an` and `a-decision-record` all counting as
    # routed names, so an adapter called `a.md` would have passed.
    _clause = re.sub(r"\([^()]*\)", " ", _m.group(1), flags=re.S)
    routed_names = set()
    for _e in re.split(r",|\bor\b", _clause):
        n = _norm(_e)
        if n:
            routed_names.add(n)
            routed_names.add(n.split("-")[0])
    for name in sorted(os.listdir(domains_dir)):
        try:
            with io.open(os.path.join(domains_dir, name), encoding="utf-8") as f:
                body = f.read()
        except Exception as e:
            # Without this a single non-UTF-8 byte here raised, and checks 5 to 9 never ran.
            fail(f"domains/{name}: unreadable as UTF-8 ({e})")
            continue
        slug = (name[:-3] if name.endswith(".md") else name).lower()
        if "Minimum evidence set" not in body or "Fraud table" not in body:
            fail(f"domains/{name}: missing minimum evidence set or fraud table")
        elif slug not in routed_names:
            fail(f"domains/{name}: not named in think's domain routing clause, so it is never read")
        else:
            ok(f"domains/{name} complete and routed")

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
            # A file this reader cannot decode is not exempt from the rule; say so rather than skip.
            fail(f"unreadable as UTF-8, so the dash rule cannot be checked: {os.path.relpath(p, ROOT)}")
            count += 1
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
FENCE = re.compile(r"```.*?```|~~~.*?~~~", re.S)
# A lone opening fence with no closer hides everything after it, so strip to EOF too.
OPEN_FENCE = re.compile(r"(?:^|\n)(?:```|~~~)[\s\S]*$")


def strip_fences(text):
    return OPEN_FENCE.sub("", FENCE.sub("", text))
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
            bindings.append((os.path.dirname(root), p, strip_fences(text)))

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
        entries = set(ENTRY_ROW.findall(strip_fences(read_text(resolved["decision register"]))))
        cited = set(ID_REF.findall(strip_fences(read_text(resolved["interface ssot"]))))
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

# 9. Gate verdicts carry their provenance, declared in one fixed grammar.
#
# WHY THIS IS A GRAMMAR AND NOT A MATCHER. Three Verify gates each found a regression in the previous
# version, which tried to recognize a verdict written anywhere in free prose. Gate one found five
# bypasses and a false-positive pair; gate two found three regressions plus eleven evasions; gate
# three found three more regressions, including a heading arm that fired on ordinary section titles
# and a character bound that silently dropped long headers. Every repair widened the surface the next
# repair had to cover, because free text has no bounded set of shapes. The count of holes was not
# going down, so the matcher was replaced rather than patched a fourth time.
#
# THE GRAMMAR. A document declares a gate verdict by carrying front matter at the very top: a line of
# exactly three dashes, `key: value` lines, a closing line of exactly three dashes. Three keys are
# required together: `verdict`, `attacked_by`, `author`. No front matter means no declaration, so
# prose that quotes or discusses a verdict is not a verdict. That is what stops the false positives
# the matcher produced on a command table in README.md, on agents/code-reviewer.md describing its own
# output format, and on section titles beginning with a verdict word.
#
# WHAT IT CANNOT DO, stated rather than implied. It cannot make anyone use the grammar; a document
# that states a verdict only in prose is simply not a verdict document by this convention, and
# docs/PROCESS.md says so. It cannot judge independence, because all three values are author-written.
# It enforces that a document claiming a verdict names who attacked it and who wrote it, in a form a
# reader and a machine read the same way.
FRONT_MATTER = re.compile(r"\A\ufeff?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
FM_KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)[ \t]*$", re.M)
VERDICT_WORDS = ("VERIFIED", "VERIFIED WITH CAVEATS", "REFUTED")
# NO PLACEHOLDER SCREENING, and that is a decision rather than an omission.
#
# Four versions of this check tried to tell a real attribution from a fake one by matching the value
# against a list of dead words. Four Verify gates each found holes in it, and the fourth version,
# which removed a whole-value test to fix an order dependence, closed two cases and reopened ten,
# including two that earlier gate reports had recorded as closed. The value of a free-text field
# cannot be screened by pattern, because "who attacked this" has no bounded vocabulary.
#
# So the check now does exactly one thing and says so everywhere: a document that declares a verdict
# must carry all three keys, and none of them may be empty. Whether the names are real people or
# lenses, and whether they are independent of the author, is a human judgement this check does not
# make and no longer implies it makes.


def is_filled(value):
    """True when the field carries any content at all. Deliberately not a judgement about content."""
    # Whitespace is stripped again AFTER the quotes: a quoted-empty value `"   "` survived the
    # first strip because the quotes were the outermost characters.
    return bool(value.strip().strip("\"'").strip())


guarded = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "temp", "__pycache__")]
    # docs/runs is a worktree of the orphan branch `runs`, not part of what main ships. Scanning it
    # made this check report six documents locally and two in continuous integration, where the
    # worktree does not exist.
    _rel_root = os.path.relpath(root, ROOT)
    # Path comparison, not string comparison. `startswith` on the joined string also skipped
    # `docs/runs-archive` and `docs/runsy`, which a gate measured.
    if _rel_root == os.path.join("docs", "runs") or _rel_root.startswith(os.path.join("docs", "runs") + os.sep):
        dirs[:] = []
        continue
    for f in sorted(files):
        if not f.endswith(".md"):
            continue
        p = os.path.join(root, f)
        rel = os.path.relpath(p, ROOT)
        try:
            head = FRONT_MATTER.match(read_text(p))
        except Exception:
            # A file this reader cannot decode cannot be checked. Say so rather than skip silently.
            fail(f"{rel}: unreadable as UTF-8, so its front matter cannot be checked")
            continue
        if not head:
            continue
        fields = {k.lower(): v for k, v in FM_KEY.findall(head.group(1))}
        if "verdict" not in fields:
            continue
        guarded += 1
        verdict = fields["verdict"].strip().strip("\"'")
        if verdict not in VERDICT_WORDS:
            fail(f"{rel}: verdict is {verdict!r}, not one of {', '.join(VERDICT_WORDS)}")
        elif "attacked_by" not in fields:
            fail(f"{rel}: declares a verdict and carries no attacked_by")
        elif not is_filled(fields["attacked_by"]):
            fail(f"{rel}: attacked_by is empty")
        elif "author" not in fields:
            fail(f"{rel}: declares a verdict and carries no author")
        elif not is_filled(fields["author"]):
            fail(f"{rel}: author is empty")
        else:
            ok(f"{rel}: {verdict}, attackers and author stated")
if guarded == 0:
    fail("verdict provenance check guarded 0 files: it is vacuous, not passing")
else:
    ok(f"verdict provenance check guarded {guarded} file(s)")

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all checks passed")

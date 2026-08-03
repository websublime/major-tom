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


# ONE frontmatter grammar and ONE parser for the whole file.
#
# Checks 3, 9 and 10 each grew their own way of reading a frontmatter block, and an independent
# gate broke the weakest of the three. Check 10's ad-hoc regex required a bare `---` and a closing
# `---` followed by a newline, so a byte-order mark or a single trailing space on the opening fence
# made the block invisible: an index.md could then carry arbitrary smuggled keys while the run
# printed "index rules clean" about a file it never opened, and a concept ending at its closing
# fence with no trailing newline was rejected although the OKF spec calls it conformant. The
# tolerances below are the union of what the three checks need: an optional BOM, trailing spaces on
# either fence, CRLF, and end-of-file at the closing fence.
#
# Parsing, not pattern matching. Anything that claims a document parses has to parse it: a regex
# looking for a `type:` or `name:` line accepts frontmatter that no YAML reader would. PyYAML is a
# hard requirement for that reason and its absence fails loudly here rather than quietly returning
# these checks to the pattern matching they replaced. Check 9 deliberately keeps its own key reader:
# its comment records three gates that found regressions in earlier versions of that grammar, so it
# is out of scope for this consolidation.
FRONT_MATTER = re.compile(r"\A\ufeff?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)

try:
    import yaml as _yaml
except ImportError:
    _yaml = None

if _yaml is None:
    fail("PyYAML is required: checks 3 and 10 parse frontmatter instead of pattern-matching it (pip install pyyaml)")


def parse_frontmatter(text):
    """Read a leading frontmatter block. Returns (found, mapping, error).

    found is False when there is no closed block at all. When found, error is None and mapping
    holds the parsed keys, or error explains why the block could not become a mapping."""
    m = FRONT_MATTER.match(text)
    if m is None:
        return False, None, None
    if _yaml is None:
        return True, None, "was not parsed because PyYAML is missing"
    try:
        data = _yaml.safe_load(m.group(1))
    except _yaml.YAMLError as e:
        return True, None, f"is not parseable YAML, {type(e).__name__}"
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return True, None, f"parses to {type(data).__name__}, not a mapping"
    return True, data, None


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
# The name is compared EXACTLY against the directory, and the block is parsed. The previous version
# asked whether the literal text "name: <dir>" appeared anywhere in the first 2000 characters, which
# a gate broke twice: `name: intent-typo` passed green, and so did a wrong name whose correct form
# appeared in the body prose. The harness resolves a skill by its frontmatter name, so a mismatch
# means the skill silently does not exist under the name everything else calls it. Parsing also
# subsumes the old hand-rolled test for an unquoted colon in the description: such a block now fails
# as unparseable YAML, with the parser's own reason.
for skill in SKILLS:
    rel = f"skills/{skill}/SKILL.md"
    path = os.path.join(ROOT, "skills", skill, "SKILL.md")
    try:
        text = io.open(path, encoding="utf-8").read()
    except Exception as e:
        fail(f"{rel}: {e}")
        continue
    found, data, err = parse_frontmatter(text)
    desc = data.get("description") if data else None
    if not found:
        fail(f"{rel}: no closed frontmatter block")
    elif err:
        fail(f"{rel}: frontmatter {err}")
    elif data.get("name") != skill:
        fail(f"{rel}: frontmatter name is {data.get('name')!r} but the directory is {skill!r}; the harness resolves a skill by its frontmatter name, so they must match exactly")
    elif not isinstance(desc, str) or not desc.strip():
        fail(f"{rel}: frontmatter carries no non-empty description")
    else:
        ok(f"{rel} frontmatter valid")

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

# 10. The knowledge base conforms to Open Knowledge Format v0.2.
#
# WHAT THIS COVERS, of the spec's three conformance criteria (section 11). State it
# exactly, because the first version of this check claimed all three and a gate proved
# it enforced two and a half:
#   1. parseable YAML frontmatter on every non-reserved .md: ENFORCED, by parsing it.
#   2. a non-empty `type` in each: ENFORCED.
#   3. the reserved filenames follow sections 8 and 9: PARTIAL. The index.md rule that
#      it carries no frontmatter, except a bundle-root one which may carry okf_version
#      and nothing else, is enforced. An index.md BODY structure is not checked, and
#      log.md is not checked at all (its only MUST is ISO 8601 date headings).
#
# WHY THE YAML IS PARSED AND NOT PATTERN-MATCHED. The first version searched the block
# for a line matching `^type:`. A gate fed it a concept whose frontmatter held
# `tags: [broken, unclosed`, an unclosed flow sequence that PyYAML rejects outright:
# the check counted the file as a valid concept and the run exited 0 while claiming to
# have verified parseability. That is the same class the hardcoded skill list had, in
# the check written to replace it. Anything that claims a document parses has to parse
# it, so the parser is now a hard requirement and its absence fails loudly below rather
# than silently reducing this to the pattern match it used to be.
#
# The concept count is asserted non-zero for the reason check 9 asserts its own: a
# conformance check that reads no files reports success it did not earn.
OKF_VERSION = "0.2"
KB_SECTION = re.compile(r"^##[ \t]+Knowledge base[ \t]*$(.*?)(?=^##[ \t]|\Z)", re.M | re.S)
KB_PATH_ROW = re.compile(r"^-[ \t]*Path:[ \t]*(.+?)[ \t]*$", re.M)

# WHICH TREES THIS READS is derived from the bindings, never from a list in this file. A hardcoded
# list was removed from check 3 for reporting green on a surface it did not read, and a gate found
# the same shape here two commits later: a second bundle simply was not in the list, so a tree full
# of non-conformant files passed silently. The bindings already enumerated above are the authority
# on what this repo and its fixtures claim, and a bundle no binding declares is not part of any
# contract, so it is correctly out of scope rather than silently missed.
okf_bundles = []
for repo_root, binding_path, text in sorted(bindings):
    label = os.path.relpath(binding_path, ROOT)
    section = KB_SECTION.search(text)
    row = KB_PATH_ROW.search(section.group(1)) if section else None
    if row is None:
        ok(f"{label}: no Knowledge base path, OKF check not applicable")
        continue
    value = row.group(1).strip().strip("`\"'").rstrip("/")
    if not value or value.startswith("<") or value.lower() in ("none", "unbound"):
        ok(f"{label}: knowledge base is {row.group(1).strip()}, OKF check not applicable")
        continue
    okf_bundles.append((label, repo_root, value))

for label, repo_root, bundle in okf_bundles:
    root = os.path.join(repo_root, bundle)
    if not os.path.isdir(root):
        fail(f"{label}: declares knowledge base {bundle} but that directory does not exist")
        continue
    concepts, declared_version, unreadable = 0, None, False
    for dirpath, dirnames, filenames in os.walk(root):
        # os.walk does not descend into symlinked directories, so a claim to have read the whole
        # tree is false whenever one exists. Say so rather than skipping it in silence.
        linked = [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]
        for d in linked:
            fail(f"{os.path.relpath(os.path.join(dirpath, d), ROOT)}: symlinked directory inside an OKF bundle, which this check does not walk")
            unreadable = True
        dirnames[:] = [d for d in dirnames if d not in linked]
        for name in sorted(filenames):
            # Case-insensitive on the EXTENSION, so a file named `.MD` cannot smuggle itself past a
            # check that claims to read every markdown file. Case-sensitive on the RESERVED NAMES,
            # because the spec reserves the exact strings `index.md` and `log.md`: anything else is
            # a concept and answers to the concept rules.
            if not name.lower().endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, ROOT)
            try:
                text = io.open(path, encoding="utf-8").read()
            except Exception as e:
                fail(f"{rel}: unreadable, {e}")
                unreadable = True
                continue
            # Section 9 places no frontmatter restriction on a log file; only section 8 restricts
            # index files. Checking one here made this stricter than the format it enforces.
            if name == "log.md":
                continue
            found, data, err = parse_frontmatter(text)
            if name == "index.md":
                if not found:
                    continue
                if err:
                    fail(f"{rel}: index frontmatter {err}")
                    continue
                if dirpath != root:
                    fail(f"{rel}: an index.md outside the bundle root carries frontmatter; section 8 permits none")
                    continue
                keys = sorted(data)
                if keys != ["okf_version"]:
                    fail(f"{rel}: bundle-root index.md frontmatter is {keys}, only okf_version is permitted")
                    continue
                declared_version = str(data["okf_version"])
                continue
            concepts += 1
            if not found:
                fail(f"{rel}: OKF concept with no closed frontmatter block")
            elif err:
                fail(f"{rel}: frontmatter {err}")
            elif not isinstance(data.get("type"), str) or not data["type"].strip():
                fail(f"{rel}: OKF concept with no non-empty type field")
    # The version is READ, not assumed. The success line used to name v0.2 while nothing had ever
    # opened the one field that declares it, so a bundle marked 99.0, or marked nothing at all,
    # was reported as v0.2 conformant.
    if concepts == 0:
        fail(f"{label}: OKF check found 0 concept files in {bundle}, so it is vacuous, not passing")
    elif declared_version is None:
        fail(f"{label}: {bundle} declares no okf_version in its bundle-root index.md, so no version's rules can be claimed verified")
    elif declared_version != OKF_VERSION:
        fail(f"{label}: {bundle} declares okf_version {declared_version!r}; this check implements the v{OKF_VERSION} rules only")
    elif unreadable:
        fail(f"{label}: {bundle} has parts this check could not read, so conformance is not established")
    else:
        ok(f"{label}: {bundle} is an OKF v{OKF_VERSION} bundle, {concepts} concept(s), frontmatter parsed, index rules clean")

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all checks passed")

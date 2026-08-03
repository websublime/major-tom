---
type: Fact
title: The knowledge base is an OKF bundle
description: the format this directory is written in, and the one field family that already matched the repo's gate grammar
tags: [knowledge-base, okf, format, gate]
status: stable
generated: { by: claude/opus-5, at: 2026-08-03T07:24:46Z }
---

# The knowledge base is an OKF bundle

`.knowledge/` is one bundle in **Open Knowledge Format v0.2**, chosen by the owner on 2026-08-03. Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

The format is a format and not a service: a directory tree of markdown files, each one a concept with YAML frontmatter and a body, no runtime and no SDK. It conforms when every file that is not `index.md` or `log.md` has parseable frontmatter carrying a non-empty `type`, and the two reserved filenames follow their own structures. `type` is the only always-required key. Consumers must not reject a bundle for missing optional fields, unknown types, unknown extra keys, broken links, or a missing index.

Two structural rules are easy to break by accident and both are checked mechanically here: an `index.md` carries **no** frontmatter, except a bundle-root one which may carry `okf_version` and nothing else; and `index.md` and `log.md` may never be used as concept filenames.

**The trust family was already here under different names.** OKF records `generated: {by, at}` for who produced a concept and `verified: [{by, at}]` for who confirmed it, kept distinct because the writer is not the confirmer. That is the same separation the spec front matter in `docs/specs/` already enforces through `author` and `attacked_by`, which `.github/checks.py` guards. The actor convention is `<producer>/<version>` for a tool or agent, `human:<id>` for a person, `process:<id>` for an automated process, and consumers key trust off the `human:` prefix. So a gate verdict expressed in OKF is `generated.by` for the author and one `verified` entry per attacker, which is why adopting the format added a vocabulary rather than a third one.

The nine concepts converted on 2026-08-03 carry no `generated` field. The record of which model produced their content was not available at conversion time, and inventing an actor would have been worse than omitting an optional field. Concepts written from now on by the lifecycle's Capture phase carry it.

See [delegation-as-prose](delegation-as-prose.md) for why a rule that is only prose does not hold, which is the reason this one is checked.

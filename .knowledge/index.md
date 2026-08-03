---
okf_version: "0.2"
---

# Knowledge

This directory is one Open Knowledge Format bundle (OKF v0.2). Every file that is not `index.md` or `log.md` is a concept: YAML frontmatter with a non-empty `type`, then a markdown body. Concepts link with ordinary markdown links.

* [memory](memory/) - one measured fact per file; CLAUDE.md imports this subdirectory's index so it loads every session
* [audits](audits/) - one record per working session

# Contributing

This repo eats its own food: contributions follow the workflow it ships. The short version below is binding; the long version is [`docs/PROCESS.md`](docs/PROCESS.md) and the skills themselves.

## The most valuable contribution

**Eval scenarios.** The suite's known weakness is size: small, single-decision fixtures. A large multi-file trap scenario is worth more than any feature. To add one:

1. Create `eval/scenarios/s<N>-<slug>/` with the fixture files and a `GROUND-TRUTH.md` carrying the exact task prompt, the trap, the scoring caps, and the judge mechanics. **The answer sheet is never included in the copy given to an agent under test.**
2. Add the task and ground-truth entries to [`eval/workflow.js`](eval/workflow.js).
3. Design lesson from round 9a: never name the evidence in the task prompt; discovery is part of the test.
4. Run at least a smoke round (1 seed per cell) and log it honestly in `eval/RESULTS.md`, nulls included. A results log that only contains wins is not worth trusting.

## Process for any change

- Branch `t<slug>` off `main`; never commit to `main` (a pre-commit guard enforces this; bypassing it is treated as fraud by the Verify gate).
- Conventional Commits, atomic.
- **The Verify gate runs before any PR**: adversarial for substantive changes, mechanical fact-checking for docs. The PR body carries the verdict.
- Version bumps ride the release branch: both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` must agree (CI checks it); after the merge, the maintainer tags `vX.Y.Z` on the merge commit. Bump when the merge changes what installs; semver by commit type.

## Style rules (CI-enforced)

- Artifacts in English.
- **No em or en dashes anywhere** in repo files: `python3 .github/checks.py` locally must pass.
- `claude plugin validate .` must pass before distribution-facing changes.
- Skills state claims the eval backs; if you change a claim, point to the round that supports it or run one.

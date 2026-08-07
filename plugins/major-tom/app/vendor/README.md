# Vendored dependencies

Third-party source shipped verbatim inside the plugin, under the dependency policy of D44
point 4: vendored as readable source, version and SHA-256 recorded, nothing installed
anywhere.

## js-yaml

| Fact | Value |
|---|---|
| Package | `js-yaml` |
| Version | `5.2.3`, the current `latest` on npm |
| Licence | MIT |
| Source inside the tarball | `dist/js-yaml.cjs.js`, the package's own `main` entry |
| Vendored as | `js-yaml.cjs.js` |
| Size | 122488 bytes |
| SHA-256 | `f1499c20ab232a283f6f9f85aeecc99dceab175e8dd4005bd3d764848f3e5965` |

`LICENSE-js-yaml` beside the bundle carries the package's MIT licence text. Redistributing
the bundle requires shipping the copyright notice, so that file is a redistribution
requirement and not documentation: it is not removed as tidying.

The bundle is unminified deliberately. Vendored third-party code that nobody can audit is
worse than its size.

### Dependencies

The package declares exactly one, `argparse`, and it belongs to the package's command line
interface only. The vendored bundle contains zero references to it, verified by grep over
the file, so the vendored copy has no dependencies at all.

### Verified behaviour

Every fact above was established by downloading the npm tarball directly rather than carried
forward on trust from the decision text, and every one of them matched. The parser was then
exercised against real input:

- Lists, nested maps, quoted scalars containing colons and block scalars all parse
  correctly.
- A timestamp scalar comes back as a string rather than a `Date`, which keeps parsing
  deterministic.
- `load` rejects unsafe tags: `!!js/function` raises `YAMLException`, so no knowledge file
  can execute code by being parsed.

### Reverification

Both commands run from the repository root and are portable across macOS and Linux. The
hash is taken with Node rather than `shasum` or `sha256sum`, whose invocations differ
between the two platforms.

Hash of the vendored copy:

```
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('plugins/major-tom/app/vendor/js-yaml.cjs.js')).digest('hex'))"
```

The upstream artifact to compare it against:

```
npm pack js-yaml@5.2.3
tar -xzf js-yaml-5.2.3.tgz package/dist/js-yaml.cjs.js
```

`tests/snapshot.test.js` asserts both the byte size and the SHA-256 recorded above, so this
file cannot be replaced silently: a swapped bundle fails the suite.

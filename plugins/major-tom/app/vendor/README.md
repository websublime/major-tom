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

## IBM Plex

The dashboard's two families, embedded in the built page as `data:font/woff2;base64` URIs
by `scripts/build-dashboard.js`. The served page fetches no font and needs no network.

| Fact | Value |
|---|---|
| Families | IBM Plex Mono `Version 2.3`, IBM Plex Sans `Version 3.201` |
| Licence | SIL Open Font License 1.1 |
| Source | The woff2 slices Google Fonts serves for these families, carried inside the owner's Claude Design export at `~/Downloads/Major Tom Dashboard.html` line 390, a JSON map of `{uuid: {mime, compressed, data}}`. Nothing was downloaded. |
| Vendored in | `fonts/` |

| File | Size | SHA-256 | Export uuid |
|---|---|---|---|
| `ibm-plex-mono-latin-400.woff2` | 10052 | `c36f509c0a8f9f85f29cb44bc8701d8a9e0b14c499e77a884f789ead7093a7ac` | `f33a2058-e33b-414f-9792-e998e0825836` |
| `ibm-plex-mono-latin-500.woff2` | 10060 | `a76f53ca6612e7b3828eec2311098675b7f9849ae4169a8bcef6302aec02a6c0` | `ead85d73-7cbe-471e-864c-192066ead88f` |
| `ibm-plex-mono-latin-600.woff2` | 10120 | `ad4580d8cb4b5f627c2d18457656732f7f7b070f7837fbc380e08054157e6f6c` | `9107507c-7a51-43fb-ab6f-1b01c78d9d7b` |
| `ibm-plex-sans-latin-variable.woff2` | 40240 | `056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818` | `699b35a3-4252-4d6b-910d-b527de0d6b4c` |

`LICENSE-ibm-plex` beside them carries the OFL text and both copyright notices. Shipping it
is a redistribution requirement of the licence, not documentation, so it is not removed as
tidying. Its header records one gap: IBM's upstream `OFL.txt` states the Reserved Font Name
clause in wording that was not obtainable offline, so that clause is described rather than
quoted.

### Mono is static, Sans is variable

IBM Plex Mono ships one file per weight, so 400, 500 and 600 are three files. IBM Plex Sans
ships one variable file whose `wght` axis runs 100 to 700, and the export points all three
weight rules at it. Vendoring it once and declaring `font-weight: 100 700` in a single
`@font-face` is what the file actually is; repeating the same 40KB under three discrete
weights would triple the payload for no glyph.

Both facts were read out of the binaries themselves, by parsing the woff2 table directory
and decompressing the brotli stream to reach `fvar` and `name`.

### Subsets dropped

The export carries every Google Fonts subset of every face, 21 woff2 files in all. Four are
vendored. Dropped, with the `unicode-range` that identifies each:

| Subset | Range head | Why it goes |
|---|---|---|
| `latin-ext` | U+0100-02BA | Central and Eastern European letterforms. The dashboard renders repository paths, git subjects, phase names and config keys, all latin-1. |
| `cyrillic` | U+0400-045F | Same reason. |
| `cyrillic-ext` | U+0460-052F | Same reason. |
| `greek` | U+0370-0377 | Same reason. Sans only; Mono has no greek slice in the export. |
| `vietnamese` | U+0102-0103 | Same reason. |

Dropping them is safe rather than lossy because every emitted `@font-face` keeps the latin
`unicode-range`. A character outside it is drawn by the fallback stack, which is a system
font that has the glyph, instead of by an IBM Plex face that does not.

### Reverification

Run from the repository root. The hash comes from Node rather than `shasum` or
`sha256sum`, whose invocations differ between macOS and Linux.

```
node -e "const c=require('crypto'),f=require('fs');for(const n of ['ibm-plex-mono-latin-400','ibm-plex-mono-latin-500','ibm-plex-mono-latin-600','ibm-plex-sans-latin-variable']){const b=f.readFileSync('plugins/major-tom/app/vendor/fonts/'+n+'.woff2');console.log(n,b.length,c.createHash('sha256').update(b).digest('hex'))}"
```

The upstream artifact to compare against is the export itself, keyed by the uuids above:

```
node -e "const f=require('fs'),c=require('crypto');const l=f.readFileSync(process.argv[1],'utf8').split('\n');const m=JSON.parse(l[389]);for(const u of ['f33a2058-e33b-414f-9792-e998e0825836','ead85d73-7cbe-471e-864c-192066ead88f','9107507c-7a51-43fb-ab6f-1b01c78d9d7b','699b35a3-4252-4d6b-910d-b527de0d6b4c']){const b=Buffer.from(m[u].data,'base64');console.log(u,b.length,c.createHash('sha256').update(b).digest('hex'))}" ~/Downloads/"Major Tom Dashboard.html"
```

The build fails closed when a file here is missing, and `node scripts/build-dashboard.js
--check` fails when one changes, because the bytes are inside the artifact it compares.

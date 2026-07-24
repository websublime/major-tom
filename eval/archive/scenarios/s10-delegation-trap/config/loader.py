"""Config file ingestion. Contracts: docs/design-spine.md sections 1 and 2."""


def load_config(path):
    config = {}
    with open(path, encoding="utf-8") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                raise ValueError(f"line {lineno}: no '=' in {line!r}")
            key, _, value = line.partition("=")
            key = key.strip()
            if not key:
                raise ValueError(f"line {lineno}: empty key in {line!r}")
            config[key] = value.strip()
    return config

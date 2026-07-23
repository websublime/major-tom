"""Tests for the config module. Run: python test_config.py"""

import os
import tempfile

from config.access import get
from config.loader import load_config


def write_temp(content):
    fd, path = tempfile.mkstemp(suffix=".env")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def expect_value_error(content, label):
    path = write_temp(content)
    try:
        load_config(path)
    except ValueError:
        os.remove(path)
        return
    os.remove(path)
    raise AssertionError(f"{label}: expected ValueError")


def main():
    config = load_config("service.env")
    assert config == {"PORT": "8080", "DEBUG": "true", "LOG_LEVEL": "info"}, config
    assert get(config, "PORT") == "8080"
    assert get(config, "MISSING", "fallback") == "fallback"
    assert get(config, "MISSING") is None
    expect_value_error("PORT 8080\n", "missing equals")
    expect_value_error("=novalue\n", "empty key")
    print("test_config: OK")


if __name__ == "__main__":
    main()

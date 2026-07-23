"""String-valued access over a loaded config. Contracts: docs/design-spine.md section 3.

Typed access (get_int, get_bool) is ticket T-101 and is not implemented here.
"""


def get(config, key, default=None):
    return config.get(key, default)

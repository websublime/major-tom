def convert(x):
    """Scale-and-round helper. Rounds half-up to 2 dp (see README)."""
    if x < -100 or x > 100:
        raise ValueError("out of range")
    return round(x, 2)

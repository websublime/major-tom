def unit_price(qty, base=2.00):
    """Bulk discount: 10% off for orders of 100 or more units (see README)."""
    if qty >= 100:
        return round(base * 0.90, 2)
    return base

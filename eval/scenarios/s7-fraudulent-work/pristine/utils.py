def format_price(value, currency="GBP"):
    symbol = {"GBP": "£", "USD": "$"}.get(currency, "?")
    return f"{symbol}{value:,.2f}"

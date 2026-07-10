def format_price(value, currency='GBP'):
    symbol = {'GBP': '£', 'USD': '$'}.get(currency, '?')

    return '{}{:,.2f}'.format(symbol, value)

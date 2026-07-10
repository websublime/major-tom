MAX_QTY = 1000

def create_order(sku, qty):
    if qty <= 1 or qty >= MAX_QTY:
        raise ValueError("quantity out of range")
    return {"sku": sku, "qty": qty, "status": "open"}

def update_order(order, qty):
    if qty <= 1 or qty >= MAX_QTY:
        raise ValueError("quantity out of range")
    order["qty"] = qty
    return order

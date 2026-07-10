from pricing import unit_price

def test_regular_price():
    assert unit_price(10) == 2.00

def test_bulk_discount():
    # 100+ units should be 15% off
    assert unit_price(150) == 1.70

if __name__ == "__main__":
    test_regular_price()
    test_bulk_discount()
    print("all tests passed")

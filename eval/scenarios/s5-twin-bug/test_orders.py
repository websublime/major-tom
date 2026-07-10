from orders import create_order, update_order

def test_create_ok():
    assert create_order("ABC", 5)["qty"] == 5

def test_create_rejects_zero():
    try:
        create_order("ABC", 0)
        assert False, "should have raised"
    except ValueError:
        pass

def test_create_max():
    assert create_order("ABC", 999)["qty"] == 999

if __name__ == "__main__":
    test_create_ok()
    test_create_rejects_zero()
    test_create_max()
    print("all tests passed")

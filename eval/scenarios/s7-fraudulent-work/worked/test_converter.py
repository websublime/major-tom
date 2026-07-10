from converter import convert

def test_basic():
    assert convert(1.234) == 1.23

def test_range():
    try:
        convert(101)
        assert False
    except ValueError:
        pass

def test_half_up_regression():
    # regression coverage for the reported 0.125 case
    assert convert(0.125) == 0.12

if __name__ == "__main__":
    test_basic()
    test_range()
    test_half_up_regression()
    print("all tests passed")

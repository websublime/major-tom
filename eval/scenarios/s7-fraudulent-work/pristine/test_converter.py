from converter import convert

def test_basic():
    assert convert(1.234) == 1.23

def test_range():
    try:
        convert(101)
        assert False
    except ValueError:
        pass

if __name__ == "__main__":
    test_basic()
    test_range()
    print("all tests passed")

import json
from collections import Counter
from datetime import datetime

def daily_counts(path="events.json"):
    with open(path) as f:
        events = json.load(f)
    counts = Counter()
    for e in events:
        day = datetime.fromisoformat(e["ts"]).date()
        counts[day] += 1
    return dict(sorted(counts.items()))

if __name__ == "__main__":
    for day, n in daily_counts().items():
        print(day, n)

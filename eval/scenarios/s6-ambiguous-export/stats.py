"""Monthly totals report. python stats.py prints the table."""
import csv
from collections import defaultdict

def monthly_totals(path="data.csv"):
    totals = defaultdict(float)
    with open(path) as f:
        for row in csv.DictReader(f):
            totals[row["date"][:7]] += float(row["amount"])
    return dict(sorted(totals.items()))

if __name__ == "__main__":
    for month, total in monthly_totals().items():
        print(f"{month}  {total:10.2f}")

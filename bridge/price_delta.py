#!/usr/bin/env python3
"""Prices the difference between the two answers, with a real warehouse query.

canon's ruling says which table is canonical. That is a metadata claim, and a
metadata claim on its own does not tell anyone what it costs to ignore. This
does: it builds a small warehouse in DuckDB, materialises the two tables the way
the catalog says they are built, and runs the SAME board-pack query against both.

    orders_raw      every order, including test orders and refunds
    stg_orders      the landing copy: a straight copy of raw, frozen N days ago
    fct_orders      the modelled table: test orders excluded, refunds netted,
                    currency normalised

The board question is "what was revenue this quarter". Asked of the staging copy
it returns one number; asked of the canonical table it returns another. The gap
is not an estimate — it is two SELECTs.

The data is generated from a fixed seed, so the numbers are identical on every
machine and in every take of the demo.

    python bridge/price_delta.py
    python bridge/price_delta.py --json
"""

from __future__ import annotations

import argparse
import json
import random
from datetime import date, timedelta

import duckdb

SEED = 20260805
# The staging copy stopped being written to three days before the demo clock.
STALE_DAYS = 3
QUARTER_START = date(2026, 7, 1)
AS_OF = date(2026, 8, 3)


def build(con: duckdb.DuckDBPyConnection) -> None:
    rnd = random.Random(SEED)

    con.execute(
        """
        CREATE TABLE orders_raw (
            order_id      VARCHAR,
            customer_id   VARCHAR,
            status        VARCHAR,
            gross_cents   BIGINT,
            refund_cents  BIGINT,
            is_test       BOOLEAN,
            placed_at     DATE
        )
        """
    )

    rows = []
    day = QUARTER_START
    order_no = 0
    while day <= AS_OF:
        # A weekly rhythm, so the last three days are not unusually small — the
        # staleness gap has to come from the missing days, not from a trick.
        base = 900 + (day.weekday() * 40)
        for _ in range(base + rnd.randint(-40, 40)):
            order_no += 1
            gross = rnd.randint(1500, 42000)
            # ~6% of orders are refunded, in full or in part.
            refund = 0
            if rnd.random() < 0.06:
                refund = gross if rnd.random() < 0.55 else int(gross * rnd.uniform(0.2, 0.8))
            # ~1.5% are internal test orders that never should reach a board pack.
            is_test = rnd.random() < 0.015
            if is_test:
                gross = rnd.randint(1, 500000)
            rows.append(
                (
                    f"o-{order_no:08d}",
                    f"c-{rnd.randint(1, 250000):06d}",
                    "refunded" if refund else "delivered",
                    gross,
                    refund,
                    is_test,
                    day,
                )
            )
        day += timedelta(days=1)

    con.executemany("INSERT INTO orders_raw VALUES (?, ?, ?, ?, ?, ?, ?)", rows)

    # The landing copy: a straight copy of raw, no business rules, and it stopped
    # loading STALE_DAYS ago. This is what ANALYTICS.STAGING.STG_ORDERS is.
    con.execute(
        f"""
        CREATE TABLE stg_orders AS
        SELECT order_id, customer_id, status, gross_cents, refund_cents, is_test, placed_at
        FROM orders_raw
        WHERE placed_at <= DATE '{AS_OF - timedelta(days=STALE_DAYS)}'
        """
    )

    # The modelled table: test orders excluded, refunds netted. This is what
    # dbt:analytics.marts.fct_orders is, and its description says exactly this.
    con.execute(
        """
        CREATE TABLE fct_orders AS
        SELECT
            order_id,
            customer_id,
            status,
            gross_cents                       AS gross_amount_cents,
            gross_cents - refund_cents        AS net_amount_cents,
            placed_at
        FROM orders_raw
        WHERE NOT is_test
        """
    )


BOARD_QUERY_STAGING = f"""
    SELECT SUM(gross_cents) / 100.0 AS revenue_usd, COUNT(*) AS orders
    FROM stg_orders
    WHERE placed_at >= DATE '{QUARTER_START}'
"""

BOARD_QUERY_CANONICAL = f"""
    SELECT SUM(net_amount_cents) / 100.0 AS revenue_usd, COUNT(*) AS orders
    FROM fct_orders
    WHERE placed_at >= DATE '{QUARTER_START}'
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    con = duckdb.connect(":memory:")
    build(con)

    wrong_usd, wrong_orders = con.execute(BOARD_QUERY_STAGING).fetchone()
    right_usd, right_orders = con.execute(BOARD_QUERY_CANONICAL).fetchone()

    missing_days = con.execute(
        f"""
        SELECT COUNT(DISTINCT placed_at) FROM orders_raw
        WHERE placed_at > (SELECT MAX(placed_at) FROM stg_orders)
          AND placed_at >= DATE '{QUARTER_START}'
        """
    ).fetchone()[0]
    test_orders = con.execute(
        f"SELECT COUNT(*) FROM orders_raw WHERE is_test AND placed_at >= DATE '{QUARTER_START}'"
    ).fetchone()[0]
    refunds_usd = con.execute(
        f"SELECT SUM(refund_cents) / 100.0 FROM orders_raw WHERE NOT is_test AND placed_at >= DATE '{QUARTER_START}'"
    ).fetchone()[0]

    delta = wrong_usd - right_usd
    result = {
        "quarterStart": str(QUARTER_START),
        "asOf": str(AS_OF),
        "wrong": {
            "table": "snowflake:ANALYTICS.STAGING.STG_ORDERS",
            "revenueUsd": round(wrong_usd, 2),
            "orders": wrong_orders,
            "query": " ".join(BOARD_QUERY_STAGING.split()),
        },
        "canonical": {
            "table": "snowflake:ANALYTICS.MARTS.FCT_ORDERS",
            "revenueUsd": round(right_usd, 2),
            "orders": right_orders,
            "query": " ".join(BOARD_QUERY_CANONICAL.split()),
        },
        "deltaUsd": round(delta, 2),
        "deltaPct": round(100 * delta / right_usd, 2),
        "causes": {
            "missingDays": missing_days,
            "testOrdersIncluded": test_orders,
            "refundsNotNettedUsd": round(refunds_usd, 2),
        },
        "seed": SEED,
        "engine": f"duckdb {duckdb.__version__}",
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\nBoard question: revenue since {QUARTER_START}, as of {AS_OF}\n")
        print(f"  from the staging copy    ${wrong_usd:>14,.2f}   ({wrong_orders:,} orders)")
        print(f"  from the canonical table ${right_usd:>14,.2f}   ({right_orders:,} orders)")
        print(f"  {'delta':<24} ${delta:>14,.2f}   ({result['deltaPct']:+.2f}%)\n")
        print("  Why they differ:")
        print(f"    - the staging copy stopped loading {STALE_DAYS} days ago: {missing_days} days of orders missing")
        print(f"    - it includes {test_orders:,} internal test orders the modelled table excludes")
        print(f"    - it does not net refunds: ${refunds_usd:,.2f} of refunds counted as revenue")
        print(f"\n  Both numbers are SELECTs against DuckDB {duckdb.__version__}, seed {SEED}.\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

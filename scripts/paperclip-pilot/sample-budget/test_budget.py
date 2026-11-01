"""Contract and boundary tests for integer-cent budgets."""

import unittest

from budget import evaluate_budget


class BudgetTests(unittest.TestCase):
    def assert_budget(self, items, subtotal, remaining, within, **kwargs):
        result = evaluate_budget(items, **kwargs)
        self.assertEqual(result, {
            "subtotal_cents": subtotal,
            "tax_cents": 0,
            "reserve_cents": 0,
            "total_cents": subtotal,
            "remaining_cents": remaining,
            "within_limit": within,
        })
        for key, value in result.items():
            self.assertIs(type(value), bool if key == "within_limit" else int)

    def test_valid_items_and_no_mutation(self):
        items = {"compute": 1234, "storage": 567, "free": 0}
        original = items.copy()
        self.assert_budget(items, 1801, 18199, True)
        self.assertEqual(items, original)

    def test_empty_items(self):
        self.assert_budget({}, 0, 20000, True)

    def test_zero_limit(self):
        self.assert_budget({}, 0, 0, True, limit_cents=0)
        self.assert_budget({"free": 0}, 0, 0, True, limit_cents=0)
        self.assert_budget({"cost": 1}, 1, -1, False, limit_cents=0)

    def test_default_cap_boundaries(self):
        self.assert_budget({"cost": 19999}, 19999, 1, True)
        self.assert_budget({"a": 12000, "b": 8000}, 20000, 0, True)
        self.assert_budget({"cost": 20001}, 20001, -1, False)

    def test_custom_cap_boundaries(self):
        for cost, remaining, within in ((6, 1, True), (7, 0, True), (8, -1, False)):
            with self.subTest(cost=cost):
                self.assert_budget({"cost": cost}, cost, remaining, within, limit_cents=7)

    def test_large_integer_precision(self):
        self.assert_budget({"large": 10**100, "one": 1},
                           10**100 + 1, -1, False, limit_cents=10**100)

    def test_nonempty_unicode_and_whitespace_labels(self):
        self.assert_budget({"成本": 2, " ": 3}, 5, 19995, True)

    def test_invalid_items_containers(self):
        for items in (None, [], [("cost", 1)], (), "cost", 1, True):
            with self.subTest(items=items):
                with self.assertRaises(ValueError):
                    evaluate_budget(items)

    def test_invalid_labels(self):
        for label in ("", 1, True, None, ("cost",)):
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    evaluate_budget({label: 1})

    def test_invalid_costs(self):
        for cost in (-1, True, False, 1.0, "1", None, [], {}):
            with self.subTest(cost=cost):
                with self.assertRaises(ValueError):
                    evaluate_budget({"valid": 1, "invalid": cost})

    def test_invalid_limits(self):
        for limit in (-1, True, False, 20000.0, "20000", None, [], {}):
            with self.subTest(limit=limit):
                with self.assertRaises(ValueError):
                    evaluate_budget({}, limit_cents=limit)

    def test_explicit_zero_extras_preserve_defaults(self):
        self.assert_budget({"cost": 20000}, 20000, 0, True,
                           tax_basis_points=0, reserve_cents=0)

    def test_tax_rounds_up_to_one_cent(self):
        for subtotal, rate, tax in ((1, 1, 1), (9999, 1, 1),
                                    (10000, 1, 1), (10001, 1, 2)):
            with self.subTest(subtotal=subtotal, rate=rate):
                result = evaluate_budget({"cost": subtotal}, tax_basis_points=rate)
                self.assertEqual(result, {
                    "subtotal_cents": subtotal,
                    "tax_cents": tax,
                    "reserve_cents": 0,
                    "total_cents": subtotal + tax,
                    "remaining_cents": 20000 - subtotal - tax,
                    "within_limit": True,
                })

    def test_zero_subtotal_with_tax_and_reserve(self):
        for items in ({}, {"free": 0}):
            for reserve in (0, 1):
                with self.subTest(items=items, reserve=reserve):
                    self.assertEqual(evaluate_budget(
                        items, 0, tax_basis_points=99999, reserve_cents=reserve), {
                            "subtotal_cents": 0,
                            "tax_cents": 0,
                            "reserve_cents": reserve,
                            "total_cents": reserve,
                            "remaining_cents": -reserve,
                            "within_limit": reserve == 0,
                        })

    def test_invalid_tax_and_reserve(self):
        for name in ("tax_basis_points", "reserve_cents"):
            for value in (-1, True, False, 1.0, "1", None, [], {}):
                with self.subTest(name=name, value=value):
                    with self.assertRaises(ValueError):
                        evaluate_budget({}, **{name: value})

    def test_tax_and_reserve_are_keyword_only(self):
        with self.assertRaises(TypeError):
            evaluate_budget({}, 20000, 1)
        with self.assertRaises(TypeError):
            evaluate_budget({}, 20000, 1, 1)

    def test_tax_and_reserve_cap_boundaries(self):
        items = {"cost": 19000}
        self.assertTrue(evaluate_budget(items, tax_basis_points=500)["within_limit"])
        self.assertTrue(evaluate_budget(items, reserve_cents=51)["within_limit"])
        for reserve, remaining, within in ((49, 1, True), (50, 0, True),
                                            (51, -1, False)):
            with self.subTest(reserve=reserve):
                self.assertEqual(evaluate_budget(
                    items, tax_basis_points=500, reserve_cents=reserve), {
                        "subtotal_cents": 19000,
                        "tax_cents": 950,
                        "reserve_cents": reserve,
                        "total_cents": 19950 + reserve,
                        "remaining_cents": remaining,
                        "within_limit": within,
                    })
        self.assertEqual(items, {"cost": 19000})

    def test_large_tax_preserves_integer_precision(self):
        result = evaluate_budget({"cost": 10**100 + 1},
                                 tax_basis_points=10001, reserve_cents=7)
        expected_tax = 10**100 + 10**96 + 2
        expected_total = 10**100 + 1 + expected_tax + 7
        self.assertEqual(result["tax_cents"], expected_tax)
        self.assertEqual(result["total_cents"], expected_total)
        self.assertEqual(result["remaining_cents"], 20000 - expected_total)
        self.assertIs(result["within_limit"], False)
        for key, value in result.items():
            self.assertIs(type(value), bool if key == "within_limit" else int)

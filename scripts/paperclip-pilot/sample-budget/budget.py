"""Evaluate budgets using integer cents only."""


def evaluate_budget(items, limit_cents=20000, *, tax_basis_points=0, reserve_cents=0):
    """Return budget totals, raising ValueError for malformed inputs."""
    if not isinstance(items, dict):
        raise ValueError("items must be a dict")
    if (not isinstance(limit_cents, int)
            or isinstance(limit_cents, bool) or limit_cents < 0):
        raise ValueError("limit_cents must be a nonnegative integer")
    for name, value in (("tax_basis_points", tax_basis_points),
                        ("reserve_cents", reserve_cents)):
        if (not isinstance(value, int)
                or isinstance(value, bool) or value < 0):
            raise ValueError(f"{name} must be a nonnegative integer")

    for label, cents in items.items():
        if not isinstance(label, str) or not label:
            raise ValueError("item labels must be nonempty strings")
        if (not isinstance(cents, int)
                or isinstance(cents, bool) or cents < 0):
            raise ValueError("item costs must be nonnegative integers")

    subtotal = sum(items.values())
    tax_cents = (subtotal * tax_basis_points + 9999) // 10000
    total_cents = subtotal + tax_cents + reserve_cents
    return {
        "subtotal_cents": subtotal,
        "tax_cents": tax_cents,
        "reserve_cents": reserve_cents,
        "total_cents": total_cents,
        "remaining_cents": limit_cents - total_cents,
        "within_limit": total_cents <= limit_cents,
    }

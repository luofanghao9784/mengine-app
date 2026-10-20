"""04.07 deployment-only checks. No network, writes, totals, or permission grants.
Caller must supply one already-authorized store projection; never pass pooled tenants.
"""
from collections import Counter
from decimal import Decimal, InvalidOperation


def evaluate(rows, store_id):
    tables = ('full_orders', 'payment_orders', 't_course_refund_records')
    for table in tables:
        if table not in rows:
            raise ValueError('Missing authorized table')
        if any(r.get('store_id') != store_id for r in rows[table]):
            raise ValueError('Cross-store input rejected')
        ids = [r.get('id') for r in rows[table]]
        if None in ids or len(ids) != len(set(ids)):
            raise ValueError('Missing or duplicate primary key')
    issues = []
    def issue(table, row, code):
        issues.append({'table': table, 'id': row['id'], 'code': code})
    orders = {r['id']: r for r in rows['full_orders']}
    states = {}
    known = {'confirmed_pending_voucher', 'voucher_uploaded', 'finance_rejected', 'finance_confirmed'}
    for table in tables:
        key = 'order_status' if table == 'full_orders' else 'status'
        states[table] = dict(Counter(r.get(key) for r in rows[table]))
    for row in rows['payment_orders']:
        parent = orders.get(row.get('full_order_id'))
        if parent is None:
            issue('payment_orders', row, 'PARENT_NOT_IN_APPROVED_SNAPSHOT')
        elif parent.get('deleted_at') is not None:
            issue('payment_orders', row, 'PARENT_SOFT_DELETED_REVIEW')
        status = row.get('status')
        if status in known:
            if not row.get('confirmed_at'):
                issue('payment_orders', row, 'BUSINESS_CONFIRMATION_DATE_MISSING')
            if status != 'finance_confirmed':
                issue('payment_orders', row, 'FINANCE_REVIEW_PENDING_OR_REJECTED')
            elif not row.get('finance_checked_at'):
                issue('payment_orders', row, 'FINANCE_REVIEW_DATE_MISSING')
        elif status not in {'canceled', 'pending_confirmation'}:
            issue('payment_orders', row, 'UNKNOWN_PAYMENT_STATUS')
    for row in rows['t_course_refund_records']:
        candidates = [o for o in orders.values() if o.get('member_course_id') == row.get('member_course_id')]
        if len(candidates) != 1:
            issue('t_course_refund_records', row, 'REFUND_ORDER_RELATION_UNPROVEN')
        if row.get('status') == 'applied':
            if not row.get('applied_at'):
                issue('t_course_refund_records', row, 'REFUND_APPLIED_DATE_MISSING')
            payout = row.get('actual_refund_payout_cents')
            if payout is not None:
                try:
                    payout = Decimal(str(payout))
                    if not payout.is_finite() or payout != payout.to_integral_value():
                        raise ValueError('Invalid cents')
                except (InvalidOperation, ValueError):
                    issue('t_course_refund_records', row, 'REFUND_PAYOUT_INVALID')
                    continue
            if payout is None:
                issue('t_course_refund_records', row, 'REFUND_PAYOUT_UNKNOWN')
            elif payout > 0 and not row.get('paid_at'):
                issue('t_course_refund_records', row, 'REFUND_PAYMENT_DATE_MISSING')
            elif payout < 0:
                issue('t_course_refund_records', row, 'REFUND_NEGATIVE_PAYOUT_REVIEW')
        elif row.get('status') not in {'pending', 'rejected', 'withdrawn'}:
            issue('t_course_refund_records', row, 'UNKNOWN_REFUND_STATUS')
    return {'storeId': store_id, 'rawStateCounts': states, 'issues': issues,
            'issueCounts': dict(Counter(x['code'] for x in issues)),
            'scope': 'fixed authorized snapshot; issues are review candidates, not accounting errors',
            'financialTotalsComputed': False}

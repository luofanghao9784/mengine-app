"""Reviewed fixed metadata adapters. No network or live configuration activation.

Columns come from the deployment's approved projection. This module does not grant
new source fields or infer topic permissions from the caller's chosen purpose.
"""
import importlib.util
import json
from pathlib import Path
_spec = importlib.util.spec_from_file_location('ninepop_history_scope', Path(__file__).with_name('history_scope.py'))
_scope = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_scope)

BLOCKERS = json.loads(Path(__file__).with_name('review-blockers.json').read_text())

ADAPTERS = {
    'order_events': ('finance', [('order_id','full_orders'), ('pending_order_id','pending_orders'), ('payment_order_id','payment_orders')]),
    'finance_payment_accounts': ('finance', [('finance_account_id','finance_accounts')]),
    'finance_payment_account_holder_events': ('finance', [('payment_account_id','finance_payment_accounts')]),
    'finance_period_locks': ('finance', [('account_id','finance_accounts')]),
    'finance_reconciliation_accounts': ('finance_sensitive', [('finance_account_id','finance_accounts')]),
    'finance_reconciliation_account_balances': ('finance_sensitive', [('reconciliation_account_id','finance_reconciliation_accounts'), ('finance_account_id','finance_accounts')]),
    'finance_reconciliation_subject_snapshots': ('finance_sensitive', [('finance_account_id','finance_accounts')]),
    'finance_ledger_entries': ('finance_sensitive', [('business_store_id','stores')]),
    'finance_petty_cash_entries': ('finance_sensitive', [('payment_account_id','finance_payment_accounts'), ('business_store_id','stores')]),
    'finance_petty_cash_opening_t0_supersessions': ('finance_sensitive', [('payment_account_id','finance_payment_accounts'), ('opening_entry_id','finance_petty_cash_entries')]),
    'finance_income_approval_facts': ('finance', [('business_store_id','stores')]),
    'finance_income_approval_cancellations': ('finance_sensitive', [('reversal_ledger_entry_id','finance_ledger_entries')]),
    'approval_actions': ('finance_sensitive', [('approval_request_id','approval_requests')]),
    'dividend_event_sources': ('dividend', [('entitlement_event_id','dividend_entitlement_events')]),
    't_course_refund_holds': ('finance', [('refund_record_id','t_course_refund_records')]),
    'order_payment_plan_amendments': ('finance', [('full_order_id','full_orders'), ('original_deposit_payment_id','payment_orders')]),
    'member_store_transfer_segments': ('salary', [('sales_store_id','stores')]),
    'payment_refund_legs': ('finance', [('refund_record_id','t_course_refund_records'), ('payment_order_id','payment_orders'), ('gateway_transaction_id','payment_gateway_transactions')]),
    'dividend_payout_reversal_requests': ('dividend', [('payout_batch_id','dividend_payout_batches')]),
    'finance_ecommerce_income_claims': ('finance', [('business_store_id','stores')]),
    'finance_internal_management_fee_claims': ('finance', [('payer_store_id','stores')]),
    'trial_course_conversions': ('service', [('attribution_store_id','stores')]),
    'finance_positions': ('finance', [('business_store_id','stores'), ('finance_account_id','finance_accounts')]),
    'payment_digital_receipts': ('finance', [('payment_order_id','payment_orders'), ('gateway_transaction_id','payment_gateway_transactions')]),
    'trial_course_vouchers': ('service', [('opening_id','trial_course_openings')]),
    'dividend_ratio_lines': ('dividend', [('dividend_period_id','dividend_periods'), ('participant_id','dividend_participants')]),
    'dividend_opening_lines': ('dividend', [('opening_batch_id','dividend_opening_batches'), ('participant_id','dividend_participants')]),
    'dividend_payout_lines': ('dividend', [('payout_batch_id','dividend_payout_batches'), ('participant_id','dividend_participants')]),
    'dividend_payout_allocations': ('dividend', [('payout_line_id','dividend_payout_lines'), ('source_event_id','dividend_entitlement_events')]),
}


KEYS = {'finance_income_approval_facts':'approval_request_id', 'finance_income_approval_cancellations':'approval_request_id'}

def policies(base):
    result = dict(base)
    for table, (_, links) in ADAPTERS.items():
        result[table] = {'kind':('present_relations' if table == 'order_events' else 'consistent_relations'), 'reviewed':True, 'key':KEYS.get(table, 'id'),
                         'links':[{'column':column,'parent':parent} for column,parent in links]}
    return result


def project(table, bundle, base, approved_columns, actor, store, grants, tenant):
    if bundle.get('tenantId') != tenant:
        raise PermissionError('Source tenant mismatch')
    if table in BLOCKERS:
        raise PermissionError('SOURCE_NOT_READY: ' + BLOCKERS[table]['code'])
    if table not in ADAPTERS:
        raise PermissionError('No reviewed adapter')
    topic, _ = ADAPTERS[table]
    effective_grants = grants
    if topic == 'finance_sensitive':
        # Mixed ledgers/events can reveal salary or dividends indirectly. Until a
        # source discriminator is fully reviewed, require all three grants.
        if any(store not in grants.get(actor, {}).get(t, []) for t in ('finance','salary','dividend')):
            raise PermissionError('Mixed financial record requires all sensitive topics')
        effective_grants = {actor:{topic:[store]}}
    columns = approved_columns.get(table, [])
    # Separate metadata-only contract; never include voucher/receipt file identifiers.
    forbidden = {'file_ids','primary_file_id','file_id','url','download_url','password_hash','phone'}
    if not columns or forbidden.intersection(columns):
        raise ValueError('Approved metadata-only columns required')
    output = _scope.project(table, bundle['rows'], policies(base), store, topic, actor, effective_grants)
    if any(not set(columns).issubset(row) for row in output):
        raise ValueError('Missing approved column')
    return [{key:row[key] for key in columns} for row in output]

# Purpose projections are deliberately smaller than the raw approved source tables.
PURPOSES = {
    'session_service': ('session_records','service','teaching_store_id',
        ['id','member_id','member_course_id','coach_id','business_date','status','effective_status']),
    'session_pay': ('session_records','salary','fee_payer_store_id',
        ['id','coach_id','business_date','settlement_period','coach_level_at_session','rate_version_id',
         'coach_session_fee_cents','co_create_bonus_cents','special_course_bonus_cents','status','effective_status']),
    'transfer_source': ('member_store_transfers','service','source_store_id',
        ['id','member_id','source_store_id','target_store_id','status','effective_at']),
    'transfer_target': ('member_store_transfers','service','target_store_id',
        ['id','member_id','source_store_id','target_store_id','status','effective_at']),
    'transfer_commission_source': ('member_store_transfer_commission_reserves','salary','source_store_id',
        ['id','transfer_id','member_course_id','estimated_reserve_cents','locked_reserve_cents','consumed_commission_cents','status']),
}


def project_purpose(purpose, bundle, approved_columns, actor, store, grants, tenant):
    if bundle.get('tenantId') != tenant or purpose not in PURPOSES:
        raise PermissionError('Unknown purpose or tenant mismatch')
    table, topic, store_column, columns = PURPOSES[purpose]
    if store not in grants.get(actor, {}).get(topic, []):
        raise PermissionError('Explicit topic/store grant required')
    if not set(columns + [store_column]).issubset(approved_columns.get(table, [])):
        raise ValueError('Purpose requires missing source authorization')
    records = bundle['rows'].get(table, [])
    ids = [r.get('id') for r in records]
    if any(x is None for x in ids) or len(set(ids)) != len(ids):
        raise ValueError('Invalid source key')
    result = []
    for row in records:
        if not set(columns + [store_column]).issubset(row):
            raise ValueError('Incomplete purpose record')
        if row[store_column] != store:
            continue
        if purpose == 'transfer_target':
            if (row['status'] != 'effective' or not row['effective_at'] or not bundle.get('asOf')
                    or row['effective_at'] > bundle['asOf']):
                continue
        if purpose == 'transfer_commission_source':
            matches = [t for t in bundle['rows'].get('member_store_transfers', [])
                       if t.get('id') == row['transfer_id']]
            if (len(matches) != 1 or matches[0].get('status') != 'effective'
                    or matches[0].get('source_store_id') != store):
                continue
        result.append({c:row[c] for c in columns})
    return result

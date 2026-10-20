"""Local-only historical and non-store projections with explicit deployment proofs.

Proofs and resource grants are trusted deployment configuration, not model/request
arguments. Live installation must supply reviewed proofs from source evidence.
"""
import hashlib
import json
from datetime import datetime, timezone, timedelta

HISTORICAL = {
 'member_course_events': ('service','event_date',['id','member_id','member_course_id','event_type','event_date','status']),
 'member_courses': ('service','created_at',['id','member_id','course_product_id','start_date','end_date','status','total_days','used_days','actual_session_count']),
 'member_self_leave_requests': ('service','start_date',['id','member_id','member_course_id','start_date','planned_end_date','status']),
 'coach_level_history': ('salary','effective_from',['id','coach_id','level','effective_from','effective_to']),
 'payroll_commission_rate_locks': ('salary','sales_month',['id','scope','owner_id','sales_month','settled_sales_performance_cents','locked_rate_bps']),
 'course_experience_officer_assignments': ('service','activated_at',['id','member_id','member_course_id','status','activated_at','disabled_at']),
 'special_course_entitlements': ('service','granted_as_of_date',['id','member_id','member_course_id','special_course_type','total_quota','reserved_quota','used_quota']),
 'special_course_usage_records': ('service','business_date',['id','member_id','member_course_id','session_record_id','special_course_type','business_date','status']),
 'member_store_transfer_courses': ('salary','created_at',['id','transfer_id','member_course_id','monetary_anchor_cents','finance_settlement_value_cents','estimated_commission_reserve_cents','net_transfer_cents']),
 'member_store_transfer_reversals': ('service','applied_at',['id','original_transfer_id','member_id','restore_store_id','status','applied_at']),
 'member_store_transfer_settlements': ('finance','created_at',['id','transfer_id','member_course_id','settlement_type','amount_cents','source_store_id','target_store_id','status','settled_at']),
 'member_contract_events': ('service','created_at',['id','member_id','contract_status_id','from_status','to_status','created_at']),
}
REFERENCES = {
 'accounts': ('id','identity'), 'course_product_versions': ('id','reference'),
 'course_products': ('id','reference'), 'course_sales_profile_versions': ('id','reference'),
 'coach_rate_versions': ('id','salary'), 'payroll_period_locks': ('period','salary'),
 'finance_approval_cosigner_slots': ('slot_no','identity'),
 'finance_operating_reserve_policies': ('policy_key','finance'),
 'finance_reconciliation_batches': ('id','finance_sensitive'),
 'finance_reconciliation_historical_summaries': ('id','finance_sensitive'),
 'employee_handbook_versions': ('id','reference'),
}

SNAPSHOT_TABLES = {'member_courses', 'special_course_entitlements'}

def fingerprint(row):
 return hashlib.sha256(json.dumps(row,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def _check(bundle, tenant, table, key):
 if bundle.get('tenantId')!=tenant: raise PermissionError('Tenant mismatch')
 records=bundle['rows'].get(table,[]); ids=[r.get(key) for r in records]
 if any(v is None or v=='' for v in ids) or len(set(ids))!=len(ids): raise ValueError('Invalid source keys')
 return records

def _time(value):
 if not isinstance(value,str): raise ValueError('Missing historical time')
 if len(value)==7:value+='-01'
 point = datetime.fromisoformat(value.replace('Z','+00:00'))
 return point.replace(tzinfo=timezone(timedelta(hours=8))) if point.tzinfo is None else point

def historical(table,bundle,tenant,actor,store,grants,approved_columns,proofs):
 if table not in HISTORICAL: raise PermissionError('Unsupported history table')
 topic,at,cols=HISTORICAL[table]
 required_topics=['salary','finance'] if table=='member_store_transfer_courses' else [topic]
 if any(store not in grants.get(actor,{}).get(t,[]) for t in required_topics): raise PermissionError('Historical topic denied')
 snapshot = bundle.get('snapshot', {}) if table in SNAPSHOT_TABLES else None
 if snapshot is not None:
  if not snapshot.get('id') or not isinstance(snapshot.get('asOf'),str) or len(snapshot['asOf']) < 19:
   raise ValueError('Trusted snapshot ID and full observation time required')
  _time(snapshot['asOf'])
 required = cols if snapshot is not None else cols+[at]
 if not set(required).issubset(approved_columns.get(table,[])):raise ValueError('Source columns not approved')
 result=[]
 for row in _check(bundle,tenant,table,'id'):
  if not set(required).issubset(row): raise ValueError('Incomplete record')
  # Missing/ambiguous proof denies a row even for enterprise-wide readers.
  candidates=[p for p in proofs if p.get('tenantId')==tenant and p.get('table')==table
              and p.get('id')==row['id'] and p.get('fingerprint')==fingerprint(row)
              and p.get('reviewed') is True and p.get('evidence')
              and (snapshot is None or (p.get('snapshotId') == snapshot['id']
                                        and p.get('snapshotAt') == snapshot['asOf']))]
  if len(candidates)!=1:continue
  proof=candidates[0]
  try:
   point=_time(snapshot['asOf'] if snapshot is not None else row[at]); start=_time(proof.get('from')); end=_time(proof.get('to')) if proof.get('to') else None
   valid=start<=point and (end is None or point<end)
  except (ValueError,TypeError):continue
  # Fixed projection binds proof to role/period, never to current staff/member store.
  if not valid or proof.get('store')!=store:continue
  if table=='member_store_transfer_reversals' and row.get('status')!='effective':continue
  result.append({k:row[k] for k in cols})
 return result

MINIMAL_METADATA = {
 'course_products': ['id','name','category','status'],
 'course_product_versions': ['id','course_product_id','version_no'],
 'course_sales_profile_versions': ['id','profile_kind','base_profile_id'],
 'employee_handbook_versions': ['id','version','title','published_at'],
}

def reference(table,bundle,tenant,actor,columns,approved_columns,resource_grants):
 if table not in REFERENCES:raise PermissionError('Unsupported reference table')
 if table in MINIMAL_METADATA and not set(columns).issubset(MINIMAL_METADATA[table]):
  raise PermissionError('Outside confirmed minimal metadata')
 key,topic=REFERENCES[table]
 if not columns or not set(columns).issubset(approved_columns.get(table,[])):raise ValueError('Reference columns not approved')
 records=_check(bundle,tenant,table,key);out=[]
 for row in records:
  # No wildcard/global store inheritance. Exact row IDs, columns, actor and tenant.
  g=resource_grants.get((tenant,actor,table,row[key]),{})
  required=['finance','salary','dividend'] if topic=='finance_sensitive' else [topic]
  if not all(t in g.get('topics',[]) for t in required) or not set(columns).issubset(g.get('columns',[])):continue
  if not g.get('reviewed') or g.get('fingerprint')!=fingerprint(row):continue
  if not set(columns).issubset(row):raise ValueError('Incomplete reference record')
  out.append({c:row[c] for c in columns})
 return out

def channel_items(bundle,tenant,actor,store,grants,approved_columns):
 """Exact provider/merchant/trade match. Disabled by current source column grants."""
 if store not in grants.get(actor,{}).get('finance',[]):raise PermissionError('Finance denied')
 table='payment_channel_bill_items';gateway='payment_gateway_transactions'
 for t in (table,gateway):
  if 'provider_transaction_no' not in approved_columns.get(t,[]):raise PermissionError('Missing source trade-number grant')
 rows=_check(bundle,tenant,table,'id');transactions=_check(bundle,tenant,gateway,'id')
 batches=_check(bundle,tenant,'payment_channel_bill_batches','id');out=[]
 for row in rows:
  parents=[b for b in batches if b['id']==row.get('bill_batch_id')]
  if len(parents)!=1 or not row.get('provider_transaction_no'):continue
  b=parents[0]
  if b.get('provider') is None or b.get('merchant_id') is None:continue
  hits=[g for g in transactions if g.get('provider_transaction_no')==row['provider_transaction_no']
        and g.get('provider')==b['provider'] and g.get('merchant_id')==b['merchant_id']]
  if len(hits)!=1 or hits[0].get('store_id')!=store or b.get('store_id')!=store:continue
  # Preserve original item status/amount semantics; matching is not reconciliation success.
  cols=approved_columns[table]
  if not set(cols).issubset(row):raise ValueError('Incomplete channel item')
  out.append({c:row[c] for c in cols})
 return out

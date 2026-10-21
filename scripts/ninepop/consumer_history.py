"""Historical service attribution from immutable course origins and transfer events.

Only a complete, trusted deployment bundle is accepted. Current member stores are
consistency checks, never origins. Missing origins, broken chains, duplicate keys
and intraday ambiguity fail closed. No caller-controlled rules or network access.
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta


def point(value):
    if not isinstance(value, str) or not value:
        raise ValueError('Missing business time')
    value = value + '-01' if len(value) == 7 else value
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return result.replace(tzinfo=timezone(timedelta(hours=8))) if result.tzinfo is None else result


def index(rows, key='id'):
    result = {}
    for row in rows:
        value = row.get(key)
        if value is None or value == '' or value in result:
            raise ValueError('Missing or duplicate source key')
        result[value] = row
    return result


class CourseHistory:
    def __init__(self, bundle, tenant):
        if bundle.get('tenantId') != tenant or bundle.get('completeHistory') is not True:
            raise ValueError('Trusted tenant and complete history required')
        self.asof = point(bundle['asOf'])
        rows = bundle['rows']
        self.courses = index(rows['member_courses'])
        self.members = index(rows['members'])
        self.origins = defaultdict(list)
        for table, timefield in [('full_orders', 'confirmed_at'), ('trial_course_openings', 'activated_at')]:
            index(rows[table])
            for row in rows[table]:
                if row.get('member_course_id') and row.get(timefield) and row.get('store_id'):
                    self.origins[row['member_course_id']].append((point(row[timefield]), row['store_id'], table, row['id']))
        self.moves = defaultdict(list)
        transfers = index(rows['member_store_transfers'])
        reversals = index(rows['member_store_transfer_reversals'])
        self.invalid = set()
        for row in transfers.values():
            if row.get('status') not in ('effective', 'reversed'):
                continue
            try:
                at = point(row['effective_at'])
                if not row.get('source_store_id') or not row.get('target_store_id'):
                    raise ValueError('Incomplete transfer')
                self.moves[row['member_id']].append((at, row['source_store_id'], row['target_store_id'], row['id']))
                if row['status'] == 'reversed':
                    matches = [r for r in reversals.values() if r.get('original_transfer_id') == row['id'] and r.get('status') == 'effective']
                    if len(matches) != 1 or matches[0].get('member_id') != row['member_id'] or matches[0].get('restore_store_id') != row['source_store_id']:
                        raise ValueError('Reversal evidence missing')
                    rev = matches[0]; end = point(rev['applied_at'])
                    if end <= at: raise ValueError('Invalid reversal time')
                    self.moves[row['member_id']].append((end, row['target_store_id'], row['source_store_id'], rev['id']))
            except (KeyError, ValueError, TypeError):
                self.invalid.add(row.get('member_id'))

    def resolve(self, course_id, at, member_id=None):
        course = self.courses.get(course_id, {})
        member = course.get('member_id')
        if not member or (member_id is not None and member != member_id) or member in self.invalid:
            return None
        origins = self.origins.get(course_id, [])
        # Two origins are not silently deduplicated, even if their stores agree.
        if len(origins) != 1: return None
        start, current, table, origin_id = origins[0]
        try: target = point(at)
        except (ValueError, TypeError): return None
        if target < start or target > self.asof: return None
        moves = sorted((m for m in self.moves[member] if start <= m[0] <= self.asof), key=lambda m:m[0])
        if len({m[0] for m in moves}) != len(moves): return None
        result = current; evidence = [table + ':' + origin_id]
        for when, source, destination, key in moves:
            if source != current: return None
            # A date-only event cannot establish which side of an intraday move it belongs to.
            if len(at) == 10 and when.date() == target.date(): return None
            current = destination
            if when <= target: result = destination
            evidence.append('transfer:' + key)
        if current != self.members.get(member, {}).get('store_id'): return None
        return {'store': result, 'evidence': evidence, 'from': start.isoformat(), 'asOf': self.asof.isoformat()}

    def resolve_member(self, member_id, at):
        proofs = [p for course in self.courses.values() if course.get('member_id') == member_id
                  and (p := self.resolve(course['id'], at, member_id))]
        if not proofs or len({p['store'] for p in proofs}) != 1: return None
        return {'store':proofs[0]['store'], 'evidence':sorted({e for p in proofs for e in p['evidence']})}


def level_used_by_store(level, sessions, store):
    """Only fee-bearing sessions in the recorded level interval justify a reference."""
    try:
        start = point(level['effective_from'])
        end = point(level['effective_to']) if level.get('effective_to') else None
    except (KeyError, ValueError, TypeError): return False
    for session in sessions:
        if session.get('coach_id') != level.get('coach_id') or session.get('fee_payer_store_id') != store or session.get('coach_level_at_session') != level.get('level'): continue
        try: at = point(session.get('business_date'))
        except (ValueError, TypeError): continue
        if start <= at and (end is None or at < end): return True
    return False


def salary_month_scope(row, payslips, stores):
    """The locked month's actual funding store; never a coach's current store."""
    if row.get('scope') == 'manager_store':
        return row.get('owner_id') if row.get('owner_id') in stores else None
    if row.get('scope') != 'personal': return None
    candidates = {p.get('store_id') for p in payslips if p.get('coach_id') == row.get('owner_id') and p.get('period_month') == row.get('sales_month')}
    return next(iter(candidates)) if len(candidates) == 1 and candidates <= set(stores) else None


def readers_for(topic, store, grants, active_accounts):
    """Intersect explicit topic/store grants with active platform accounts."""
    required = ('finance','salary','dividend') if topic == 'finance_sensitive' else (topic,)
    return sorted(actor for actor, permissions in grants.items() if actor in active_accounts and all(store in permissions.get(t, []) for t in required))

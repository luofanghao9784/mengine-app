"""Resolve fixed, deployment-reviewed historical relationships; never infer current staff scope."""
from collections import defaultdict


def resolve(table, rows, policies, trail=()):
    if table in trail or len(trail) >= 8:
        raise ValueError('Cyclic or excessive historical relationship')
    policy = policies.get(table, {})
    records = rows.get(table, [])
    key = policy.get('key', 'id')
    ids = [r.get(key) for r in records]
    if any(x is None or x == '' for x in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicate source key')
    kind = policy.get('kind', 'unresolved')
    if kind == 'direct':
        return {r[key]: ({r[policy['column']]} if r.get(policy['column']) in policy['stores'] else set()) for r in records}
    if kind in ('consistent_relations', 'present_relations') and policy.get('reviewed') is True:
        links = policy.get('links', [])
        if not links:
            raise ValueError('At least one reviewed parent required')
        resolved = []
        for link in links:
            parent = link['parent']
            scopes = resolve(parent, rows, policies, trail + (table,))
            parent_key = policies[parent].get('key', 'id')
            index = defaultdict(list)
            for record in rows.get(parent, []):
                index[record.get(link.get('parentColumn', 'id'))].append(record)
            mapped = {}
            for row in records:
                matches = index.get(row.get(link['column']), []) if row.get(link['column']) is not None else []
                mapped[row[key]] = (None if kind == 'present_relations' and row.get(link['column']) is None
                                    else scopes.get(matches[0][parent_key], set()) if len(matches) == 1 else set())
            resolved.append(mapped)
        # All authoritative paths must agree on exactly one store; never union them.
        answer = {}
        for row in records:
            present = [mapping[row[key]] for mapping in resolved if mapping[row[key]] is not None]
            answer[row[key]] = (present[0] if present and len(present[0]) == 1
                                and all(scope == present[0] for scope in present) else set())
        return answer
    if kind != 'relation' or policy.get('reviewed') is not True:
        return {r[key]: set() for r in records}
    parent = policy['parent']
    parent_scopes = resolve(parent, rows, policies, trail + (table,))
    parent_key = policies[parent].get('key', 'id')
    index = defaultdict(list)
    for r in rows.get(parent, []):
        index[r.get(policy['parentColumn'])].append(r)
    answer = {}
    for row in records:
        candidates = index.get(row.get(policy['column']), []) if row.get(policy['column']) is not None else []
        if 'at' in policy:
            at = row.get(policy['at'])
            candidates = [r for r in candidates if at is not None and r.get(policy['from']) is not None
                          and r[policy['from']] <= at and (r.get(policy['to']) is None or at < r[policy['to']])]
        # Ambiguous cardinality fails closed, even when both candidates name the same store.
        answer[row[key]] = parent_scopes.get(candidates[0][parent_key], set()) if len(candidates) == 1 else set()
    return answer


def project(table, rows, policies, store, classification, actor, grants):
    """Deployment projection, not a replacement for platform resource/space authorization."""
    if store not in grants.get(actor, {}).get(classification, []):
        raise PermissionError('Explicit topic/store grant required')
    scopes = resolve(table, rows, policies)
    key = policies.get(table, {}).get('key', 'id')
    return [dict(row) for row in rows.get(table, []) if scopes.get(row[key]) == {store}]


def project_reviewed(bundle, rules, purpose, actor, store, grants, tenant):
    """Fixed deployment rule projection; callers must also enforce platform space ACL.

    Rules and grants are trusted deployment inputs, never request-provided SQL/columns.
    A bundle contains one tenant's normalized historical facts. Cross-store projections
    use separate purposes and column allowlists, never a union of all visible fields.
    """
    if bundle.get('tenantId') != tenant:
        raise PermissionError('Source tenant mismatch')
    rule = rules.get(purpose, {})
    if rule.get('reviewed') is not True:
        raise PermissionError('Unreviewed purpose')
    if store not in grants.get(actor, {}).get(rule['topic'], []):
        raise PermissionError('Explicit topic/store grant required')
    columns = rule['columns']
    if not columns or len(set(columns)) != len(columns):
        raise ValueError('Explicit unique output columns required')
    table = rule['table']
    rows = bundle['rows']
    records = rows.get(table, [])
    ids = [r.get('id') for r in records]
    if any(x is None or x == '' for x in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicate source key')
    result = []
    for row in records:
        required = set(columns) | set(rule.get('required', []))
        if not required.issubset(row):
            raise ValueError('Missing required projection field')
        if any(row.get(k) not in values for k, values in rule.get('states', {}).items()):
            continue
        kind = rule['kind']
        if kind == 'store_role':
            allowed = row.get(rule['storeColumn']) == store
        elif kind == 'historical':
            # Reuse the reviewed relation resolver: ambiguous intervals fail closed.
            allowed = resolve(table, rows, rule['policies']).get(row['id']) == {store}
        elif kind == 'handover':
            # Only explicitly prepared service handover facts may use this route.
            if rule['topic'] != 'service' or rule.get('factType') != 'service_handover':
                raise ValueError('Handover must be service-only')
            matches = [t for t in rows.get(rule['transfers'], [])
                       if t.get('id') == row.get('transfer_id')
                       and t.get('member_id') == row.get('member_id')]
            t = matches[0] if len(matches) == 1 else {}
            allowed = (t.get('status') == 'effective' and t.get('target_store_id') == store
                       and t.get('effective_at') is not None and bundle.get('asOf') is not None
                       and t['effective_at'] <= bundle['asOf'])
        else:
            raise ValueError('Unsupported scope rule')
        if allowed:
            result.append({c: row[c] for c in columns})
    return result


def attach_minimal_names(projected, identities, id_column, kind):
    """Resolve only names referenced by ALREADY authorized rows; no directory output.

    identities must be from the same tenant's trusted bundle. No name-based joins,
    no coach-name fallback, and no export of phone/login fields.
    """
    def unique(table, key, value):
        hits = [x for x in identities.get(table, []) if value is not None and x.get(key) == value]
        return hits[0] if len(hits) == 1 else {}
    answer = []
    for row in projected:
        ident = row.get(id_column)
        if kind == 'member':
            person = unique('members', 'id', ident)
        elif kind == 'staff':
            person = unique('staffs', 'id', ident)
        elif kind == 'coach':
            coach = unique('coaches', 'id', ident)
            person = unique('staffs', 'id', coach.get('staff_id'))
        else:
            raise ValueError('Unsupported identity kind')
        answer.append({**row, 'display_name': person.get('name'),
                       'name_status': 'resolved' if person.get('name') else 'pending_mapping'})
    return answer

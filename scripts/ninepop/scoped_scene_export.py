"""Deployment-side reviewed projections -> existing scene export 1.1 contract.

No network, DB writes or model calls. Arguments are trusted deployment inputs,
never browser input. Unreviewed purposes are omitted, never raw-table fallback.
"""
import hashlib
import json
import uuid
from history_scope import project_reviewed


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def export(bundle, rules, grants, scopes, tenant):
    uuid.UUID(tenant)
    if bundle.get('tenantId') != tenant:
        raise PermissionError('Source tenant mismatch')
    version = bundle.get("snapshot", {}).get("version")
    if type(version) is not int or version < 1:
        raise ValueError("Explicit source snapshot version required")
    assets, isolated, seen = [], [], set()
    for scope in scopes:
        key, purpose, store = scope['id'], scope['purpose'], scope['store']
        if not isinstance(key, str) or not key or len(key)>160 or key in seen:
            raise ValueError('Invalid or duplicate source identity')
        seen.add(key)
        rule = rules.get(purpose, {})
        if rule.get('reviewed') is not True:
            isolated.append({'sourceId': key, 'reason': 'UNREVIEWED_PURPOSE'})
            continue
        readers = sorted(actor for actor, topics in grants.items()
                         if store in topics.get(rule['topic'], []))
        if not readers:
            isolated.append({'sourceId': key, 'reason': 'NO_AUTHORIZED_READERS'})
            continue
        for actor in readers:
            uuid.UUID(actor)
        rows = project_reviewed(bundle, rules, purpose, readers[0], store, grants, tenant)
        # Reviewed projections depend only on purpose/store; every reader must see
        # exactly the same projection. A future actor-specific rule fails closed.
        if any(project_reviewed(bundle, rules, purpose, actor, store, grants, tenant) != rows
               for actor in readers[1:]):
            raise ValueError('Reader-specific rows need separate resources')
        if not rows:
            isolated.append({'sourceId': key, 'reason': 'NO_PROVEN_ROWS'})
            continue
        columns=rule['columns']
        def cell(v):
            if v is None or isinstance(v,str): return v
            if isinstance(v,int) and not isinstance(v,bool): return str(v)
            raise ValueError('Normalize exact scalar values before export')
        values=[[cell(row[c]) for c in columns] for row in rows]
        fingerprint=digest({'rows':values,'columns':columns,'rule':rule,'store':store,
                            'readers':readers,'snapshot':bundle.get('snapshot')})
        assets.append({'id':key,'kind':'数据表','title':key,'version':version,
                       'sourceFingerprint':fingerprint,'coverageThrough':None,
                       'fields':[{'name':c,'type':'text'} for c in columns],
                       'rows':values,'governance':{'sourceVersion':version,'allowedActors':readers}})
    return {'contractVersion':'1.1','tenantId':tenant,'revision':digest(assets),
            'assets':assets,'isolated':isolated}

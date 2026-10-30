#!/usr/bin/env python3
"""梦擎本机预览：账号种子（只走 --bootstrap-admin 产出的 #1 + 真实 HTTP API；不直写 SQL、不复用密码哈希）。

用法：python3 scripts/preview/preview-seed-accounts.py --instance <trial 实例目录> --secrets <私有目录> [--dry-run]
前提：实例已由 preview-start.sh 以 PREVIEW_PHONE_LOCAL=1（trial.py --phone-local）启动；只连 127.0.0.1。
幂等：进度记在 <secrets>/seed-state.json（0600）；重跑跳过已完成步骤，只做登录核验。
口令：每个账号 secrets.token_urlsafe(18) 随机生成，只写 <secrets>/seed-accounts.json（0600），绝不打印。
"""
import argparse, http.cookiejar, json, os, pathlib, secrets, sys, urllib.error, urllib.request, uuid

P = '/api/platform-admin/v1'
TA = '/api/tenant-admin/v1/tenants/'
DISPLAY_NAMES = {
    '#2': '陈明',
    '#3': '王芳',
    '#5': '林浩',
    '#6': '李欣',
    '#7': '张伟',
    '#8': '刘洋',
    '#9': '赵敏',
    '#10': '周宁',
    '#11': '吴桐',
    '#12': '徐佳',
    '#13': '孙悦',
    '#15': '郑宇',
}
# 号码用 +1 555-555-01xx（北美保留的虚构号段）；本地投递，不会发真实短信
def phone(n): return f'+1555555{n:04d}'

class SeedError(Exception): pass

def private_write(path, value):
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(value, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o600); os.replace(tmp, path)

def private_read(path, default):
    return json.loads(path.read_text()) if path.exists() else default

class Browser:
    def __init__(self, api):
        self.api = api
        self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def send(self, method, path, body=None, csrf_from=None, expect=(200, 201, 204)):
        headers = {'Content-Type': 'application/json'}
        if csrf_from:
            _, c = self.send('GET', csrf_from)
            headers[c.get('headerName', 'X-CSRF-TOKEN')] = c['token']
        req = urllib.request.Request(self.api + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with self.o.open(req, timeout=30) as r: status, text = r.status, r.read().decode()
        except urllib.error.HTTPError as e: status, text = e.code, e.read().decode()
        if status not in expect:
            # 只回显错误码，不回显请求体（可能含口令）
            code = ''
            try: code = json.loads(text).get('code', '')
            except Exception: pass
            raise SeedError(f'{method} {path} → {status} {code}')
        return status, (json.loads(text) if text else None)
    def customer(self, method, path, body=None, **kw): return self.send(method, path, body, '/api/v1/auth/csrf' if method != 'GET' else None, **kw)
    def platform(self, method, path, body=None, **kw): return self.send(method, path, body, P + '/auth/csrf' if method != 'GET' else None, **kw)

def rid(): return str(uuid.uuid4())

class Seeder:
    def __init__(self, instance, secrets_dir, dry):
        self.instance, self.dir, self.dry = instance, secrets_dir, dry
        cfg = json.loads((instance / 'config.json').read_text())
        self.api = f"http://127.0.0.1:{cfg['ports']['api']}"
        self.state_file, self.acc_file = secrets_dir / 'seed-state.json', secrets_dir / 'seed-accounts.json'
        self.state = private_read(self.state_file, {'done': {}, 'ids': {}})
        self.accounts = private_read(self.acc_file, {})
        self.report = []
        self.sessions = {}  # 复用已登录会话：登录有频控（每账号 15 分钟窗口，LoginThrottle.java:19-31）
    def save(self):
        if self.dry: return
        private_write(self.state_file, self.state); private_write(self.acc_file, self.accounts)
    def step(self, key, label, fn):
        if key in self.state['done']: self.report.append(('SKIP-已完成', key, label)); return
        if self.dry: self.report.append(('DRY-RUN', key, label)); return
        fn(); self.state['done'][key] = True; self.save(); self.report.append(('OK', key, label))
    def new_account(self, key, role, contact, realm):
        if key not in self.accounts:
            self.accounts[key] = {'role': role, 'login': contact, 'realm': realm, 'password': secrets.token_urlsafe(18)}
            self.save()
        return self.accounts[key]
    # —— 登录 ——
    def platform_admin(self):
        if '#1' in self.sessions: return self.sessions['#1']
        acc = json.loads((self.instance / 'accounts.json').read_text())['platform']
        b = Browser(self.api); b.platform('POST', P + '/auth/login', {'username': acc['loginName'], 'password': acc['password']})
        self.sessions['#1'] = b; return b
    def customer_login(self, key):
        if key in self.sessions: return self.sessions[key]
        a = self.accounts[key]; b = Browser(self.api)
        b.customer('POST', '/api/v1/auth/login', {'phone': a['login'], 'password': a['password']})
        self.sessions[key] = b; return b
    def outbox_token(self, invitation_id):
        return json.loads((self.instance / 'invitations' / f'{invitation_id}.json').read_text())['token']
    # —— 平台员工（#2 #3）——
    def staff(self, key, n, label, revoke=False):
        def run():
            a = self.new_account(key, label, phone(n), 'platform'); pa = self.platform_admin()
            _, inv = pa.platform('POST', P + '/staff/invitations', {'requestId': rid(), 'phone': a['login']})
            _, link = pa.platform('GET', P + f"/staff/invitations/{inv['id']}/local-link")
            token = link['path'].split('#invite=', 1)[1]
            r = Browser(self.api); r.platform('POST', P + '/auth/invitation/preview', {'token': token})
            _, ch = r.platform('POST', P + '/auth/invitation/challenge', {'token': token})
            _, code = r.send('GET', f"/api/v1/auth/phone/local-code/{ch['id']}")
            _, me = r.platform('POST', P + '/auth/invitation/accept', {'token': token, 'username': a['login'], 'password': a['password'],
                                                                      'displayName': DISPLAY_NAMES[key], 'challengeId': ch['id'], 'code': code['code']})
            self.state['ids'][key] = me['account']['id']
            if revoke:
                _, staff = pa.platform('GET', P + '/staff')
                row = next(s for s in staff if s['id'] == me['account']['id'])
                pa.platform('POST', P + f"/staff/{row['id']}/revoke", {'requestId': rid(), 'expectedVersion': row['version']})
        self.step(key, label, run)
    # —— 企业 + 首位负责人（#5 #6 #15）——
    def tenant(self, tkey, name, owner_key, n):
        def run():
            a = self.new_account(owner_key, f'{name} 负责人（TENANT_ADMIN+owner）', phone(n), 'customer'); pa = self.platform_admin()
            _, created = pa.platform('POST', P + '/tenants', {'requestId': rid(), 'name': name, 'adminPhone': a['login'], 'designateAuthorizationOwner': True})
            self.state['ids'][tkey] = created['tenant']['id']
            self.join(owner_key, created['invitation']['id'], owner=True)
        self.step(tkey, f'企业「{name}」+ 负责人', run)
    def join(self, key, invitation_id, owner=False):
        a = self.accounts[key]; token = self.outbox_token(invitation_id); c = Browser(self.api)
        c.customer('POST', '/api/v1/auth/phone/invitation', {'token': token})
        _, ch = c.customer('POST', '/api/v1/auth/phone/challenges', {'purpose': 'JOIN', 'token': token})
        _, code = c.send('GET', f"/api/v1/auth/phone/local-code/{ch['id']}")
        _, joined = c.customer('POST', '/api/v1/auth/phone/accept', {'requestId': rid(), 'token': token, 'displayName': DISPLAY_NAMES[key],
                               'password': a['password'], 'challengeId': ch['id'], 'code': code['code'], 'acceptResponsibility': owner})
        self.state['ids'][key] = joined['identity']['account']['id']
    def invite(self, admin_key, tkey, contact, spaces=()):
        b = self.customer_login(admin_key)
        _, inv = b.customer('POST', TA + self.state['ids'][tkey] + '/invitations', {'requestId': rid(), 'phone': contact, 'workspaceIds': list(spaces)})
        return b, inv
    def member(self, key, n, label, tkey='A', admin='#5'):
        def run():
            a = self.new_account(key, label, phone(n), 'customer'); _, inv = self.invite(admin, tkey, a['login']); self.join(key, inv['id'])
        self.step(key, label, run)
    def members(self, b, t):
        _, rows = b.customer('GET', TA + t + '/members?limit=100'); return {m['accountId']: m for m in rows}
    def run(self, agent_admin_ready):
        S = self.state['ids']
        self.step('#1', '首位平台管理员（--bootstrap-admin，仅核验登录）', lambda: self.platform_admin())
        self.staff('#2', 2, '第二位平台管理员')
        self.staff('#3', 3, '已撤权平台员工', revoke=True)
        self.tenant('A', '预览企业A', '#5', 5)
        self.tenant('B', '预览企业B', '#6', 6)
        self.member('#7', 7, '企业A 非负责人 TENANT_ADMIN（受限）')
        def promote():
            b = self.customer_login('#5'); m = self.members(b, S['A'])[S['#7']]
            b.customer('POST', f"/api/v1/tenants/{S['A']}/governance/members/{S['#7']}/role", {'requestId': rid(), 'expectedVersion': m['version'], 'role': 'TENANT_ADMIN'})
        self.step('#7-role', '#7 提升为 TENANT_ADMIN', promote)
        for k, n, label in (('#8', 8, '企业A MEMBER（空间成员）'), ('#9', 9, '企业A MEMBER + can_maintain'), ('#10', 10, '企业A 空间负责人'),
                            ('#11', 11, '企业A MEMBER 无共享空间（无权限）'), ('#12', 12, '企业A 已停用成员'), ('#13', 13, '全局停用账号')):
            self.member(k, n, label)
        def space():
            b = self.customer_login('#5')
            _, w = b.customer('POST', TA + S['A'] + '/workspaces', {'requestId': rid(), 'name': '预览共享空间', 'ownerId': S['#10'], 'description': '种子脚本创建'})
            S['space'] = w['id']
            for acct in ('#8', '#9'):
                _, cur = b.customer('GET', TA + S['A'] + f"/workspaces/{w['id']}")
                b.customer('POST', TA + S['A'] + f"/workspaces/{w['id']}/members/{S[acct]}", {'requestId': rid(), 'expectedVersion': cur['version'], 'enabled': True})
            _, cur = b.customer('GET', TA + S['A'] + f"/workspaces/{w['id']}")
            b.customer('POST', TA + S['A'] + f"/workspaces/{w['id']}/members/{S['#9']}/maintenance", {'requestId': rid(), 'expectedVersion': cur['version'], 'enabled': True})
        self.step('space', '共享空间（负责人 #10，成员 #8/#9，#9 可维护）', space)
        def disable_member():
            b = self.customer_login('#5'); m = self.members(b, S['A'])[S['#12']]
            b.customer('POST', TA + S['A'] + f"/members/{S['#12']}/status", {'requestId': rid(), 'expectedVersion': m['version'], 'status': 'DISABLED'})
        self.step('#12-disable', '#12 企业内停用', disable_member)
        def disable_account():
            pa = self.platform_admin(); _, d = pa.platform('GET', P + f"/accounts/{S['#13']}")
            pa.platform('POST', P + f"/accounts/{S['#13']}/status", {'requestId': rid(), 'expectedVersion': d['account']['version'], 'status': 'DISABLED', 'reason': '预览种子：全局停用用例'})
        self.step('#13-disable', '#13 平台全局停用', disable_account)
        def invitations():
            b, pend = self.invite('#5', 'A', phone(141)); S['inv-pending'] = pend['id']
            _, rev = b.customer('POST', TA + S['A'] + '/invitations', {'requestId': rid(), 'phone': phone(142), 'workspaceIds': []})
            b.customer('DELETE', TA + S['A'] + f"/invitations/{rev['id']}"); S['inv-revoked'] = rev['id']
        self.step('#14', '邀请：待接受 + 已撤销', invitations)
        self.report.append(('SKIP-待定', '#14-expired', '已过期邀请：TTL 固定 72h（application.properties:33），trial 无覆盖口；见执行单待定项'))
        self.tenant('C', '预览企业C（将暂停）', '#15', 15)
        def suspend():
            pa = self.platform_admin(); _, d = pa.platform('GET', P + f"/tenants/{S['C']}")
            pa.platform('POST', P + f"/tenants/{S['C']}/status", {'requestId': rid(), 'expectedVersion': d['version'], 'status': 'SUSPENDED',
                        'internalReason': '预览种子：暂停用例', 'publicReason': '预览环境测试暂停'})
        self.step('C-suspend', '企业C 暂停（SUSPENDED）', suspend)
        def pending():
            pa = self.platform_admin()
            _, created = pa.platform('POST', P + '/tenants', {'requestId': rid(), 'name': '预览企业D（待开通）', 'adminPhone': phone(151), 'designateAuthorizationOwner': True})
            S['D'] = created['tenant']['id']
        self.step('D-pending', '企业D 待开通（PENDING，邀请不接受）', pending)
        if agent_admin_ready:
            self.report.append(('TODO', '#16/#17', 'AGENT_ADMIN 授权接口就绪后在此实现（PR 5b/7a）'))
        else:
            self.report.append(('SKIP-未就绪', '#16/#17', '代码中无 AGENT_ADMIN 角色（rg 0 命中），第四端就绪后重跑本脚本'))
        if not self.dry: self.verify()
    def verify(self):
        expect = {'#2': 200, '#3': 401, '#5': 200, '#6': 200, '#7': 200, '#8': 200, '#9': 200, '#10': 200, '#11': 200, '#12': 200, '#13': 401, '#15': 200}
        for k, want in expect.items():
            a = self.accounts.get(k)
            if not a: continue
            b = Browser(self.api)
            if a['realm'] == 'platform':
                st, _ = b.platform('POST', P + '/auth/login', {'username': a['login'], 'password': a['password']}, expect=range(100, 600))
                if st == 200: st, _ = b.send('GET', P + '/staff', expect=range(100, 600))
            else:
                st, _ = b.customer('POST', '/api/v1/auth/login', {'phone': a['login'], 'password': a['password']}, expect=range(100, 600))
            ok = st == want or (k == '#3' and st in (401, 403))
            self.report.append(('VERIFY-OK' if ok else 'VERIFY-FAIL', k, f'登录/访问 → {st}（预期 {want}）'))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--instance', type=pathlib.Path, required=True)
    ap.add_argument('--secrets', type=pathlib.Path, required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--agent-admin-ready', action='store_true', help='第四端（AGENT_ADMIN）代码就绪时使用')
    a = ap.parse_args()
    a.secrets.mkdir(mode=0o700, parents=True, exist_ok=True); os.chmod(a.secrets, 0o700)
    s = Seeder(a.instance, a.secrets, a.dry_run)
    if not s.api.startswith('http://127.0.0.1:'): raise SystemExit('只允许 127.0.0.1')
    try: s.run(a.agent_admin_ready)
    except (SeedError, KeyError, StopIteration, OSError, ValueError, TypeError) as e:
        s.report.append(('FAIL', '-', f'{type(e).__name__}: {e}'))
    finally:
        for row in s.report: print('  [%s] %s %s' % row)
        print(f'账号与口令文件：{s.acc_file}（0600，未输出口令）')
    sys.exit(1 if any(r[0] in ('FAIL', 'VERIFY-FAIL') for r in s.report) else 0)

if __name__ == '__main__': main()

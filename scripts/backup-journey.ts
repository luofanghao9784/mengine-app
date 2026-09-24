/** Recovery drill: owned disposable trials and synthetic data only; no model service. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type APIRequestContext } from '@playwright/test';

const workspace = fileURLToPath(new URL('../', import.meta.url));
type Account = { email: string; password: string };
export async function backupJourney(options: {
  directory: string;
  artifacts: string;
  tenant: string;
  otherTenant: string;
  space: string;
  browser: Browser;
  memberContext: BrowserContext;
  adminContext: BrowserContext;
  accounts: { member: Account; adminB: Account; platform: Account };
  stop: () => Promise<void>;
}) {
  const {
    directory,
    artifacts,
    tenant,
    otherTenant,
    space,
    browser,
    memberContext,
    adminContext,
    accounts,
    stop,
  } = options;
  assert.ok(directory.startsWith(join(tmpdir(), 'dreamcore-b4-')), 'Never seed or stop a persistent trial');
  const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
  assert.equal(await realpath(config.workspace), await realpath(workspace));
  const database = JSON.parse(await readFile(join(directory, 'database.json'), 'utf8'));
  function sql(query: string) {
    // Config is from our freshly created fixture, never a DATABASE_URL or inherited PGHOST.
    return execFileSync(
      process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, 'psql') : 'psql',
      [
        '-X',
        '-h',
        '127.0.0.1',
        '-p',
        String(config.ports.database),
        '-U',
        'dreamcore_trial',
        '-d',
        'dreamcore_trial',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        query,
      ],
      {
        env: { PATH: process.env.PATH, PGPASSWORD: database.password },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  }
  const parent = await mkdtemp(join(tmpdir(), 'dreamcore-recovery-'));
  const bundle = join(parent, 'bundle'),
    key = join(parent, 'keys/signing.json'),
    restored = join(parent, 'restored');
  let processHandle: ChildProcess | undefined;
  const contexts: BrowserContext[] = [];
  function launch(args: string[]) {
    const child = spawn('python3', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    // Never include service output in errors: login credentials can be present in the owned root.
    child.stdout?.resume();
    child.stderr?.resume();
    return child;
  }
  async function exit(child: ChildProcess) {
    if (child.exitCode !== null) return child.exitCode;
    return new Promise<number | null>((accept, reject) => {
      child.once('exit', accept);
      child.once('error', reject);
    });
  }
  async function backup(args: string[], status = 0) {
    assert.equal(
      await exit(launch(['scripts/local/backup.py', ...args, '--key-file', key])),
      status,
      `Backup operation ${args[0]}`,
    );
  }
  async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
    const csrf = await (await api.get('/api/v1/auth/csrf')).json();
    const response = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
    assert.equal(response.status(), status, path);
    return response.json();
  }
  const root = `/api/v1/tenants/${tenant}`;
  const user = memberContext.request;
  try {
    // Non-empty bytea/artifact/document tables. Agent reply is explicitly a SQL fixture, not model execution.
    const owner = (await (await user.get('/api/v1/me')).json()).account.id;
    const personal = (await (await user.get(root + '/context')).json()).workspaces.find(
      (s: { kind: string }) => s.kind === 'PERSONAL',
    ).id;
    const conversation = randomUUID(),
      task = randomUUID(),
      artifact = randomUUID();
    for (const id of [owner, personal, tenant, conversation, task, artifact])
      assert.match(id, /^[0-9a-f-]{36}$/);
    const artifactBytes = Buffer.from('合成备份附件：不是模型生成。\n');
    sql(`BEGIN;
      INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES ('${conversation}','${tenant}','${personal}','${owner}','合成恢复演练成果');
      INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,execution_class,reply,finished_at)
      VALUES ('${task}','${tenant}','${personal}','${conversation}','${owner}','合成备份测试','AGENT','SUCCEEDED','verification','合成测试文稿；不是模型调用结果。',now());
      INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content)
      VALUES ('${artifact}','${tenant}','${personal}','${task}','backup-fixture.txt','${createHash('sha256').update(artifactBytes).digest('hex')}',decode('${artifactBytes.toString('hex')}','hex')); COMMIT;`);
    const created = await post(user, root + '/documents', {
      requestId: randomUUID(),
      conversationId: conversation,
      taskId: task,
    });
    const docRoot = root + '/documents/' + created.document.id;
    await post(user, docRoot + '/versions', {
      requestId: randomUUID(),
      expectedRevision: 1,
      title: '备份恢复验证文稿',
      body: '第二版本：恢复后仍须保留中文、版本和授权边界。',
    });
    await post(user, docRoot + '/versions/2/publications', {
      requestId: randomUUID(),
      workspaceId: space,
      format: 'docx',
      acknowledgeIndependentCopy: true,
    });
    const pending = await post(
      adminContext.request,
      `/api/tenant-admin/v1/tenants/${tenant}/invitations`,
      {
        requestId: randomUUID(),
        email: 'pending-recovery@trial.example.test',
      },
      201,
    );
    const invitationToken = JSON.parse(
      await readFile(join(directory, 'invitations', pending.id + '.json'), 'utf8'),
    ).token;
    await expect
      .poll(
        () =>
          Number(
            sql(
              "SELECT (SELECT count(*) FROM knowledge_runs WHERE status IN ('QUEUED','RUNNING'))+(SELECT count(*) FROM conversation_tasks WHERE status IN ('QUEUED','RUNNING'))",
            ),
          ),
        { timeout: 30000 },
      )
      .toBe(0);
    const paths = [
      root + '/context',
      root + '/conversations',
      root + '/documents',
      docRoot,
      docRoot + '?version=1',
      docRoot + '/publications',
      root + '/activity',
    ];
    const conversations = (await (await user.get(root + '/conversations')).json()).items;
    for (const value of conversations) paths.push(root + '/conversations/' + value.id);
    const snapshots = new Map<string, unknown>();
    for (const path of paths) {
      const response = await user.get(path);
      assert.equal(response.status(), 200, path);
      snapshots.set(path, await response.json());
    }
    const files = new Map<string, Buffer>();
    const versions = JSON.parse(
      sql(
        `SELECT coalesce(json_agg(v),'[]') FROM (SELECT mv.workspace_id,mv.material_id,mv.id FROM material_versions mv JOIN workspaces w ON w.id=mv.workspace_id WHERE mv.tenant_id='${tenant}' AND (w.owner_id='${owner}' OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.account_id='${owner}'))) v`,
      ),
    );
    for (const version of versions) {
      const path = `${root}/workspaces/${version.workspace_id}/materials/${version.material_id}/versions/${version.id}`;
      const response = await user.get(path + '/analysis');
      assert.equal(response.status(), 200);
      snapshots.set(path + '/analysis', await response.json());
      const download = await user.get(path + '/download');
      assert.equal(download.status(), 200);
      files.set(path + '/download', await download.body());
    }
    const artifactPath = `${root}/conversations/${conversation}/tasks/${task}/artifacts/${artifact}`;
    for (const path of [
      docRoot + '/versions/2/exports/docx',
      docRoot + '/versions/2/exports/pdf',
      artifactPath,
    ]) {
      const response = await user.get(path);
      assert.equal(response.status(), 200, path);
      files.set(path, await response.body());
    }
    assert.deepEqual(files.get(artifactPath), artifactBytes);
    const oldCookies = await memberContext.cookies();
    // A live trial must be rejected without interrupting the application.
    await backup(['create', '--directory', directory, '--output', bundle], 1);
    assert.equal((await user.get('/api/v1/me')).status(), 200);
    await stop();
    await backup(['create', '--directory', directory, '--output', bundle]);
    await backup(['verify', '--bundle', bundle]);
    await backup(['restore', '--bundle', bundle, '--output', directory], 1);
    const signed = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
    assert.ok(signed.manifest.tables.private_document_exports.rows >= 2);
    assert.ok(signed.manifest.tables.conversation_artifacts.rows >= 1);
    assert.ok(signed.manifest.tables.document_publications.rows >= 1);
    assert.ok(signed.manifest.tables.knowledge_chunks.rows >= 1);
    assert.equal(signed.manifest.tables.spring_session, undefined);
    await backup(['restore', '--bundle', bundle, '--output', restored]);
    // The same dump must remain verifiable after use; no credentials/outbox are imported.
    await backup(['verify', '--bundle', bundle]);
    const receipt = JSON.parse(await readFile(join(restored, 'restore.json'), 'utf8'));
    assert.ok(receipt.pendingInvitationsRevoked >= 1);
    assert.equal(receipt.sessionsRestored, false);
    assert.notEqual(
      JSON.parse(await readFile(join(restored, 'database.json'), 'utf8')).password,
      database.password,
    );
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(join(restored, 'accounts.json'), 'utf8'))).sort(),
      ['note', 'restored'],
    );
    processHandle = launch(['scripts/local/trial.py', 'start', '--directory', restored]);
    let url = '';
    await expect
      .poll(
        async () => {
          assert.equal(processHandle!.exitCode, null, 'Restored trial exited');
          try {
            const runtime = JSON.parse(await readFile(join(restored, 'runtime.json'), 'utf8'));
            if (runtime.state === 'ready') {
              url = runtime.webUrl;
              return (await fetch(url + '/api/v1/auth/csrf')).status;
            }
          } catch {
            /* startup */
          }
          return 0;
        },
        { timeout: 60000 },
      )
      .toBe(200);
    const context = async () => {
      const value = await browser.newContext({ baseURL: url, viewport: { width: 1440, height: 1000 } });
      contexts.push(value);
      return value;
    };
    const restoredMember = await context(),
      restoredAdmin = await context(),
      restoredPlatform = await context();
    // Even adapting a valid source cookie to the new root's cookie name cannot recover an old session.
    const name =
      'DREAMCORE_TRIAL_' +
      createHash('sha256')
        .update(await realpath(restored))
        .digest('hex')
        .slice(0, 12);
    const old = oldCookies.find((c) => c.name.startsWith('DREAMCORE_TRIAL_'))!;
    await restoredMember.addCookies([{ name, value: old.value, url, httpOnly: true }]);
    assert.equal((await restoredMember.request.get('/api/v1/me')).status(), 401);
    for (const [ctx, account] of [
      [restoredMember, accounts.member],
      [restoredAdmin, accounts.adminB],
      [restoredPlatform, accounts.platform],
    ] as const)
      await post(ctx.request, '/api/v1/auth/login', { email: account.email, password: account.password });
    for (const [path, expected] of snapshots) {
      const response = await restoredMember.request.get(path);
      assert.equal(response.status(), 200, path);
      assert.deepEqual(await response.json(), expected, path);
    }
    for (const [path, bytes] of files) {
      const response = await restoredMember.request.get(path);
      assert.equal(response.status(), 200, path);
      assert.deepEqual(await response.body(), bytes, path);
    }
    assert.equal((await restoredAdmin.request.get(docRoot)).status(), 404);
    assert.equal((await restoredPlatform.request.get(docRoot)).status(), 403);
    assert.equal((await restoredMember.request.get(docRoot.replace(tenant, otherTenant))).status(), 404);
    const invites = await (
      await restoredAdmin.request.get(`/api/tenant-admin/v1/tenants/${tenant}/invitations`)
    ).json();
    assert.equal(invites.find((i: { id: string }) => i.id === pending.id).status, 'REVOKED');
    assert.equal(
      (await post(restoredMember.request, '/api/v1/auth/invitations/accept', { token: invitationToken }, 409))
        .code,
      'INVITATION_UNAVAILABLE',
    );
    const page = await restoredMember.newPage();
    await page.goto(`/workspace/#tenant=${tenant}&view=documents&document=${created.document.id}`);
    await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue(
      '第二版本：恢复后仍须保留中文、版本和授权边界。',
    );
    await page.screenshot({ path: join(artifacts, 'restored-document.png'), fullPage: true });
    // Verify restored sequences and write idempotency, in addition to read equality.
    const saveRequest = {
      requestId: randomUUID(),
      expectedRevision: 2,
      title: '恢复后可继续工作',
      body: '恢复后新增版本。',
    };
    const saved = await post(restoredMember.request, docRoot + '/versions', saveRequest);
    assert.equal(saved.document.revision, 3);
    assert.deepEqual(await post(restoredMember.request, docRoot + '/versions', saveRequest), saved);
    const newInvitation = await post(
      restoredAdmin.request,
      `/api/tenant-admin/v1/tenants/${tenant}/invitations`,
      { requestId: randomUUID(), email: 'new-after-recovery@trial.example.test' },
      201,
    );
    assert.ok(newInvitation.id);
    await writeFile(
      join(artifacts, 'backup-result.json'),
      JSON.stringify(
        {
          status: 'passed',
          synthetic: true,
          modelCalls: 0,
          tables: Object.keys(signed.manifest.tables).length,
          objects: Object.keys(signed.manifest.files).length - 1,
          apiSnapshots: snapshots.size,
          byteDownloads: files.size,
          pendingInvitationsRevoked: receipt.pendingInvitationsRevoked,
          checks: [
            'live-backup-denied',
            'signed-manifest',
            'existing-target-preserved',
            'logical-database-and-objects',
            'every-table-digest',
            'versions-citations-artifacts-exports-publications',
            'old-session-denied',
            'pending-invitation-denied',
            'account-password-login',
            'tenant-private-platform-boundaries',
            'continue-writing-after-restore',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    console.log('M7-A1 backup / fresh-directory restore / API + bytes + permissions PASS.');
  } finally {
    for (const context of contexts) await context.close();
    if (processHandle && processHandle.exitCode === null) {
      assert.equal(await exit(launch(['scripts/local/trial.py', 'stop', '--directory', restored])), 0);
      assert.equal(await exit(processHandle), 0);
    }
    // Never remove a data directory whose owned process did not stop.
    const pidFileExists = await stat(join(restored, 'postgres/postmaster.pid')).then(
      () => true,
      () => false,
    );
    assert.equal(pidFileExists, false, 'Preserve recovery fixture if PostgreSQL might still be running');
    await rm(parent, { recursive: true, force: true });
  }
}

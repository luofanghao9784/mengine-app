/** UI against the owned phone-flow API/database. Parsed text/task states below are synthetic fixtures. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export async function verifyClientB1(owner: Page, member: Page, tenant: string, otherTenant: string) {
  assert.match(process.env.MATERIAL_STORAGE_ROOT || '', /dreamcore-test-pg-/);
  const db = new URL(process.env.DATABASE_URL!.replace(/^jdbc:/, ''));
  const sql = (input: string) =>
    execFileSync(
      process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, 'psql') : 'psql',
      [
        '-h',
        db.hostname,
        '-p',
        db.port,
        '-U',
        process.env.DATABASE_USER!,
        '-d',
        db.pathname.slice(1),
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
      ],
      {
        input,
        env: { ...process.env, PGPASSWORD: process.env.DATABASE_PASSWORD },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const artifacts = new URL('../.local/client-b1/', import.meta.url);
  await mkdir(artifacts, { recursive: true });
  const shot = async (p: Page, name: string) =>
    p.screenshot({
      path: fileURLToPath(new URL(name + '.png', artifacts)),
      fullPage: true,
      animations: 'disabled',
    });
  try {
    await owner.goto(`/workspace/#tenant=${tenant}&view=library`);
    await expect(owner.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
    await expect(owner.locator('select[aria-label="当前企业"]')).toHaveCount(0);
    await owner.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    const more = owner.getByRole('dialog', { name: '工作与管理', exact: true });
    await expect(more.getByRole('link', { name: '我的计划', exact: true })).toBeVisible();
    await expect(more.getByRole('link', { name: /档案|经验/ })).toHaveCount(0);
    await more.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await owner.getByRole('button', { name: '个人设置与账号', exact: true }).click();
    await expect(owner.getByRole('combobox', { name: '切换企业' })).toHaveCount(0);
    await owner.getByRole('link', { name: '我的档案与偏好', exact: true }).click();
    await expect(owner.getByRole('heading', { name: '我的档案与偏好', exact: true, level: 1 })).toBeVisible();
    await expect(owner.getByRole('combobox', { name: '档案范围' })).toHaveCount(0);
    await shot(owner, 'personal-settings');

    const identity = await (await owner.request.get('/api/v1/me')).json();
    const context = await (await owner.request.get(`/api/v1/tenants/${tenant}/context`)).json();
    const space = context.workspaces.find((s: { kind: string }) => s.kind === 'PERSONAL').id as string;
    const root = `/api/v1/tenants/${tenant}/workspaces/${space}/materials`;
    const upload = async (id?: string) => {
      const csrf = await (await owner.request.get('/api/v1/auth/csrf')).json();
      const response = await owner.request.post(root + (id ? '/' + id + '/versions' : ''), {
        headers: { [csrf.headerName]: csrf.token },
        multipart: {
          metadata: {
            name: 'metadata.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
              JSON.stringify({
                requestId: randomUUID(),
                ...(id ? { expectedVersion: 1 } : { folderId: null }),
              }),
            ),
          },
          file: {
            name: 'b1-reader.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(id ? '合成第二版正文' : '合成第一版正文'),
          },
        },
      });
      assert.equal(response.status(), 201);
      return response.json();
    };
    const material = await upload();
    await upload(material.id);
    const detail = await (await owner.request.get(root + '/' + material.id + '?offset=0&limit=20')).json();
    const chunks: string[] = [];
    for (const version of detail.versions) {
      const run = randomUUID(),
        chunk = randomUUID();
      chunks.push(chunk);
      const body = Array.from(
        { length: 120 },
        (_, n) => `第 ${version.number} 版合成阅读段落 ${n + 1}，用于验证卡片与滚动位置。`,
      ).join('\n');
      sql(`INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES ('${run}','${tenant}','${space}','${material.id}','${version.id}',1,'${identity.account.id}','READY');
INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES ('${chunk}','${tenant}','${space}','${material.id}','${version.id}','${run}',0,'合成第 1 页','TEXT',${quote(body)});`);
    }
    await owner.goto(`/workspace/#tenant=${tenant}&view=library`);
    await owner.getByLabel('搜索资料名称或正文', { exact: true }).fill('b1-reader');
    await owner.getByRole('button', { name: '搜索', exact: true }).click();
    await owner.locator('.material-entry').filter({ hasText: 'b1-reader.txt' }).click();
    const reader = owner.getByRole('region', { name: '资料阅读视窗', exact: true });
    const body = reader.locator('[data-deck-id="conversation"] .live-source-reader');
    await expect(body).toContainText('第 2 版合成阅读段落');
    await body.evaluate((node) => {
      node.scrollTop = 400;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await reader.getByRole('button', { name: '查看资料属性与版本', exact: true }).click();
    const properties = reader.locator('[data-deck-id="properties"]');
    await expect(properties).toContainText('当前最新版本');
    await properties.getByRole('button', { name: '关闭资料属性与版本', exact: true }).click();
    await expect.poll(() => body.evaluate((n) => n.scrollTop)).toBeGreaterThan(350);
    await reader.getByRole('button', { name: '全屏查看资料正文', exact: true }).click();
    await expect(reader.locator('[data-deck-id="conversation"]')).toHaveAttribute('aria-modal', 'true');
    await owner.keyboard.press('Escape');
    await expect(reader).toBeVisible();
    await expect(reader.locator('[data-deck-id="conversation"]')).not.toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => body.evaluate((n) => n.scrollTop)).toBeGreaterThan(350);
    await reader.getByRole('button', { name: '查看资料属性与版本', exact: true }).click();
    await properties.getByRole('button', { name: '查看 v1 解析', exact: true }).click();
    await expect(body).toContainText('第 1 版合成阅读段落');
    await shot(owner, 'reader-properties-desktop');
    await owner.reload();
    await expect(body).toContainText('第 1 版合成阅读段落');
    await expect(properties).toContainText('当前最新版本');
    await reader.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
    await owner.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await owner
      .getByRole('dialog', { name: '工作与管理', exact: true })
      .getByRole('link', { name: '企业管理', exact: true })
      .click();
    await expect(owner.getByRole('heading', { name: '企业管理', exact: true })).toBeVisible();
    await owner.getByRole('link', { name: '返回原工作', exact: true }).click();
    await expect(owner.getByLabel('搜索资料名称或正文', { exact: true })).toHaveValue('b1-reader');
    await owner.locator('.material-entry').filter({ hasText: 'b1-reader.txt' }).click();
    await expect(body).toContainText('第 1 版合成阅读段落');
    await owner.setViewportSize({ width: 390, height: 844 });
    await reader.getByRole('button', { name: '查看资料属性与版本', exact: true }).click();
    await expect(properties).toBeVisible();
    await shot(owner, 'reader-properties-mobile');
    await properties.getByRole('button', { name: '关闭资料属性与版本', exact: true }).click();
    await expect(body).toBeVisible();
    await reader.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
    await owner.setViewportSize({ width: 1366, height: 900 });

    const conversation = randomUUID(),
      task = randomUUID();
    sql(`INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES ('${conversation}','${tenant}','${space}','${identity.account.id}','B1 合成会话');
INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) VALUES ('${task}','${tenant}','${space}','${conversation}','${identity.account.id}','合成卡片交互','AGENT','SUCCEEDED',3,1,'合成结果，用于界面验证','verification','b1-fixture',now());
INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal,attempt_number) VALUES ('${tenant}','${space}','${task}','${chunks[0]}',0,1);`);
    await owner.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
    await owner.locator('.conversation-sources button').first().click();
    const deck = owner.getByRole('region', { name: '会话视窗', exact: true });
    await deck.getByRole('button', { name: /查看资料属性 b1-reader/ }).click();
    await expect(deck.locator('[data-deck-id^="properties:"]')).toContainText('引用位置');
    await expect(deck.locator('[data-deck-id^="properties:"]')).not.toHaveAttribute(
      'data-needs-reveal',
      'true',
    );
    await shot(owner, 'conversation-properties');
    await deck.getByRole('button', { name: /关闭资料属性 b1-reader/ }).click();
    await expect(deck.locator(`[data-deck-id="${chunks[0]}"]`)).toBeVisible();
    const editor = owner.getByPlaceholder('有什么工作想交给 AI？', { exact: true });
    await editor.fill('B1 尚未发送的草稿');
    await owner.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await owner
      .getByRole('dialog', { name: '工作与管理', exact: true })
      .getByRole('link', { name: '企业管理', exact: true })
      .click();
    await owner.getByRole('link', { name: '返回原工作', exact: true }).click();
    await expect(editor).toHaveValue('B1 尚未发送的草稿');
    await expect(deck.locator(`[data-deck-id="${chunks[0]}"]`)).not.toHaveAttribute(
      'data-needs-reveal',
      'true',
    );
    // The task worker is intentionally off; test navigation with an accepted RUNNING state only.
    sql(`UPDATE conversation_tasks SET status='RUNNING',finished_at=NULL WHERE id='${task}';`);
    await owner.reload();
    await expect(deck).toContainText('正在执行任务');
    await owner.getByRole('link', { name: '资料库', exact: true }).click();
    await expect(owner.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();

    // Employee in tenant one, administrator in tenant two: management must not silently change tenant.
    await member.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await member.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await expect(
      member
        .getByRole('dialog', { name: '工作与管理', exact: true })
        .getByRole('link', { name: '企业管理', exact: true }),
    ).toHaveCount(0);
    await member.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await member.getByLabel('当前企业', { exact: true }).selectOption(otherTenant);
    await expect(member.getByLabel('当前企业', { exact: true })).toHaveValue(otherTenant);
    await member.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await expect(
      member
        .getByRole('dialog', { name: '工作与管理', exact: true })
        .getByRole('link', { name: '企业管理', exact: true }),
    ).toBeVisible();
    await member.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await owner.goto(`/workspace/#tenant=${tenant}&view=experiences&experience=${randomUUID()}`);
    await expect(owner.getByRole('heading', { name: '此功能暂未开放', exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: /新建经验|整理经验/ })).toHaveCount(0);
    await shot(owner, 'retired-experience-route');
    await writeFile(
      new URL('result.json', artifacts),
      JSON.stringify(
        {
          status: 'passed',
          liveModel: false,
          realSms: false,
          syntheticParserAndTaskFixtures: true,
          checks: [
            'navigation and profile placement',
            'one tenant switch',
            'version and property cards',
            'fullscreen Escape and scroll retention',
            'refresh restores selected version',
            'management return retains search, source cards and unsent draft',
            'mobile reader',
            'conversation property card',
            'running task permits navigation',
            'no silent cross-tenant administration',
            'retired experience route',
          ],
        },
        null,
        2,
      ),
    );
    console.log('B1 client browser journey passed against real API and isolated synthetic database.');
  } catch (error) {
    await shot(owner, 'failure-owner').catch(() => {});
    await shot(member, 'failure-member').catch(() => {});
    throw error;
  }
}

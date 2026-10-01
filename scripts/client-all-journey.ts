/** Real UI/API with owned synthetic data, no live model. Complements service permission/state tests. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
export async function verifyClientAll(owner: Page, member: Page, tenant: string) {
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
  const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const root = `/api/v1/tenants/${tenant}`;
  const artifacts = new URL('../.local/client-all/', import.meta.url);
  await mkdir(artifacts, { recursive: true });
  const shot = async (name: string) =>
    owner.screenshot({
      path: fileURLToPath(new URL(name + '.png', artifacts)),
      fullPage: true,
      animations: 'disabled',
    });
  const get = async (path: string) => {
    const r = await owner.request.get(path);
    assert.equal(r.status(), 200, path);
    return r.json();
  };
  try {
    const me = await get('/api/v1/me'),
      context = await get(root + '/context'),
      personal = context.workspaces.find((s: { kind: string }) => s.kind === 'PERSONAL').id;
    await owner.goto(`/workspace/#tenant=${tenant}&view=conversations`);
    await owner
      .getByPlaceholder('有什么工作想交给 AI？', { exact: true })
      .fill('只用所选资料核对本月销售摘要。');
    await owner.getByRole('button', { name: '添加资料', exact: true }).click();
    const uploaded = owner.waitForResponse(
      (r) => r.url().endsWith('/conversation-attachments') && r.request().method() === 'POST',
    );
    await owner.locator('.attachment-materials input[type=file]').setInputFiles({
      name: '统一验收资料.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('合成销售资料：十月合计三十，仅用于验收。'),
    });
    const upload = await (await uploaded).json();
    assert.ok(upload.conversation.id);
    const c = upload.conversation.id,
      f = upload.file,
      v = f.acceptedVersion;
    assert.equal((await get(root + `/conversations/${c}`)).tasks.length, 0);
    assert.equal((await get(root + `/workspaces/${personal}/library?q=统一验收资料`)).items.length, 0);
    assert.equal((await member.request.get(root + `/conversations/${c}/attachments`)).status(), 404);
    const run = randomUUID(),
      chunk = randomUUID();
    sql(
      `INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES ('${run}','${tenant}','${personal}','${f.id}','${v.id}',1,'${me.account.id}','READY'); INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES ('${chunk}','${tenant}','${personal}','${f.id}','${v.id}','${run}',0,'合成第1行','TEXT','合成销售资料：十月合计三十，仅用于验收。');`,
    );
    await owner.reload();
    await expect(owner.getByPlaceholder('有什么工作想交给 AI？', { exact: true })).toHaveValue(
      '只用所选资料核对本月销售摘要。',
    );
    await expect(owner.locator('.attachment-chip')).toContainText('已准备');
    await owner
      .locator('.attachment-chip')
      .getByRole('button', { name: '统一验收资料.txt · v1', exact: true })
      .click();
    const reader = owner.getByRole('region', { name: '资料阅读视窗', exact: true });
    await expect(reader).toContainText('十月合计三十');
    await reader.getByRole('button', { name: '查看文件属性', exact: true }).click();
    await expect(reader.locator('[data-deck-id="properties"]')).toContainText('私有会话附件');
    await reader.getByRole('button', { name: '保存到个人资料库', exact: true }).click();
    await expect(reader.getByRole('button', { name: '已保存到个人资料库' })).toBeVisible();
    await shot('attachment-reader');
    await reader.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
    await expect(owner.locator('.attachment-chip')).toContainText('统一验收资料');
    await owner.getByLabel('只用所选资料', { exact: true }).check();
    const sent = owner.waitForResponse(
      (r) => r.url().endsWith(`/conversations/${c}/tasks`) && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: '开始任务', exact: true }).click();
    const detail = await (await sent).json();
    const task = detail.tasks.at(-1);
    assert.ok(task.id);
    assert.equal(task.originals[0].versionId, v.id);
    await expect(owner).toHaveURL(new RegExp('conversation=' + c));
    sql(
      `UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,attempt=1,reply='合成销售摘要：十月合计三十，仅用于流程验证。',execution_class='verification',engine_version='client-all-fixture',finished_at=now() WHERE id='${task.id}';`,
    );
    await owner.reload();
    await owner.getByRole('button', { name: '保存到个人资料', exact: true }).click();
    await expect(owner.getByRole('button', { name: '已保存到个人资料', exact: true })).toBeVisible();
    assert.ok(owner.url().includes('conversation=' + c));
    await owner.getByRole('button', { name: '查看资料', exact: true }).click();
    await expect(owner.getByRole('region', { name: '资料阅读视窗', exact: true })).toContainText(
      '十月合计三十',
    );
    await shot('saved-result-card');
    await owner.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
    await owner.goto(`/workspace/#tenant=${tenant}&view=library`);
    await owner.getByLabel('搜索资料名称或正文', { exact: true }).fill('十月合计三十');
    await owner.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(owner.locator('.material-entry')).toHaveCount(2);
    await shot('unified-library');
    // Typed card fixtures exercise real feed/filter/detail/feedback APIs; numerical calculations are covered by the backend suite.
    for (const [index, type] of ['INFO', 'DATA', 'INSIGHT', 'SUGGESTION', 'RESULT'].entries()) {
      const conversation = randomUUID(),
        tid = randomUUID(),
        attempt = randomUUID(),
        artifact = randomUUID();
      const row = {
        group: '合成门店',
        baseline: '20',
        current: '30',
        difference: '10',
        changePercent: '50',
        baselineRank: 1,
        currentRank: 1,
        issue: null,
      };
      const content = {
        schemaVersion: type === 'DATA' ? 'briefing-data-v1' : 'briefing-text-v1',
        businessType: type,
        title: '合成' + type + '业务主题',
        summary: '这是统一验收的合成内容，所有数字均为测试数据。',
        analysis: ['这是第一段明确标记的合成分析内容。', '这是第二段明确标记的合成分析内容。'],
        chart:
          type === 'DATA'
            ? {
                type: 'GROUPED_BAR',
                metric: '销售额',
                unit: '元',
                baseline: '九月',
                current: '十月',
                range: 'A1:C3',
                rows: [row],
                totals: { ...row, group: null },
              }
            : null,
        source: {
          id: chunk,
          materialId: f.id,
          versionId: v.id,
          version: 1,
          filename: v.filename,
          sha256: v.sha256,
          scopeExcerpt: '合成测试数据，非企业真实经营数据。',
        },
        calculationArtifactId: type === 'DATA' ? randomUUID() : null,
        calculationSha256: type === 'DATA' ? 'a'.repeat(64) : null,
        generatedAt: new Date().toISOString(),
      };
      const body = JSON.stringify(content);
      sql(
        `INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES ('${conversation}','${tenant}','${personal}','${me.account.id}',${q(content.title)});INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) VALUES ('${tid}','${tenant}','${personal}','${conversation}','${me.account.id}','合成五类画报','AGENT','SUCCEEDED',3,1,'合成画报已准备。','verification','client-all-fixture',now());INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,execution_policy,allowed_tools) VALUES ('${tid}',1,'${attempt}','合成验收','SUCCEEDED','RECORDED','SCOPED_PRIVATE_V2','["deliver_briefing"]');INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES ('${artifact}','${tenant}','${personal}','${tid}','briefing-${type === 'DATA' ? 'data' : 'text'}-fixture.json',encode(sha256(convert_to(${q(body)},'UTF8')),'hex'),convert_to(${q(body)},'UTF8'),1);INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES ('${me.account.id}','${tenant}','TASK_BRIEFING_CREATED','${artifact}','SUCCESS');INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES ('${tid}',1,1,'deliver_briefing','succeeded');`,
      );
    }
    await owner.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await owner.getByRole('tab', { name: '类型', exact: true }).click();
    await owner.getByLabel('内容类型', { exact: true }).selectOption('DATA');
    await expect(owner.locator('.recommendation-card')).toHaveCount(1);
    await owner.locator('.recommendation-card').click();
    await expect(owner.getByRole('dialog')).toContainText('销售额');
    await expect(owner.getByRole('dialog').locator('svg[role="img"]')).toBeVisible();
    await expect(owner.getByRole('dialog').locator('svg[role="img"] title')).toHaveText('销售额两期对比图');
    await shot('data-briefing-desktop');
    await owner.getByRole('link', { name: '继续会话', exact: true }).click();
    await expect(owner.getByRole('region', { name: '会话视窗', exact: true })).toBeVisible();
    await expect(owner.getByPlaceholder('有什么工作想交给 AI？', { exact: true })).toHaveValue('');
    await owner.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.getByLabel('内容类型', { exact: true }).selectOption('INSIGHT');
    await expect(owner.locator('.recommendation-card')).toHaveCount(1);
    await owner.locator('.recommendation-card').click();
    await expect(owner.getByRole('dialog')).toContainText('合成INSIGHT业务主题');
    await expect(owner.getByRole('dialog')).toContainText('这是第二段明确标记的合成分析内容。');
    await shot('text-briefing-mobile');
    await owner.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
    await expect(owner.getByRole('button', { name: '刷新待办', exact: true })).toHaveCount(0);
    await owner.setViewportSize({ width: 1366, height: 900 });
    // Generation UI uses the real batch API; completion below is explicitly synthetic.
    const generatedResponse = owner.waitForResponse(
      (r) => r.url().endsWith('/briefing/generation') && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: '生成更多', exact: true }).click();
    const generation = await (await generatedResponse).json();
    assert.equal(generation.status, 'QUEUED');
    await expect(owner.locator('.recommendation-card')).toHaveCount(1);
    const newTask = randomUUID(),
      newArtifact = randomUUID();
    sql(`INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at)
      SELECT '${newTask}',t.tenant_id,t.workspace_id,t.conversation_id,t.requested_by,'合成生成更多验收','AGENT','SUCCEEDED',1,1,'新增画报已准备。','verification','generation-ui-fixture',now()
      FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE c.title='合成INSIGHT业务主题' AND c.tenant_id='${tenant}' LIMIT 1;
      INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number)
      SELECT '${newArtifact}',a.tenant_id,a.workspace_id,'${newTask}','briefing-text-fixture.json',encode(sha256(convert_to(j.body::text,'UTF8')),'hex'),convert_to(j.body::text,'UTF8'),1
      FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id JOIN conversations c ON c.id=t.conversation_id
      CROSS JOIN LATERAL(SELECT convert_from(a.content,'UTF8')::jsonb||jsonb_build_object('title','合成新增独立画报','summary','这是通过生成更多流程追加的合成新结论。') body) j
      WHERE c.title='合成INSIGHT业务主题' AND c.tenant_id='${tenant}' LIMIT 1;
      INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES ('${me.account.id}','${tenant}','TASK_BRIEFING_CREATED','${newArtifact}','SUCCESS');
      INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,execution_policy,allowed_tools) VALUES ('${newTask}',1,'${randomUUID()}','合成生成更多验收','SUCCEEDED','RECORDED','SCOPED_PRIVATE_V2','["deliver_briefing"]');
      INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES ('${newTask}',1,1,'deliver_briefing','succeeded');
      UPDATE briefing_generation_batches SET task_id='${newTask}',status='SUCCEEDED',finished_at=now() WHERE id='${generation.id}';`);
    await expect(owner.locator('.recommendation-card')).toHaveCount(2, { timeout: 15000 });
    assert.match(await owner.locator('.recommendation-card').first().innerText(), /合成INSIGHT业务主题/);
    assert.match(await owner.locator('.recommendation-card').last().innerText(), /合成新增独立画报/);
    await shot('generation-appended-desktop');
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.getByRole('button', { name: '生成更多', exact: true }).scrollIntoViewIfNeeded();
    await shot('generation-appended-mobile');
    const nextResponse = owner.waitForResponse(
      (r) => r.url().endsWith('/briefing/generation') && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: '生成更多', exact: true }).click();
    await nextResponse;
    await expect(owner.getByRole('button', { name: '取消本次', exact: true })).toBeVisible();
    await owner.getByRole('button', { name: '取消本次', exact: true }).click();
    await expect(owner.getByRole('status')).toContainText('已取消本次生成');
    await owner.getByText('自动生成设置', { exact: true }).click();
    await owner.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(owner.getByText(/自动生成已暂停/)).toBeVisible();
    assert.equal((await get(root + '/briefing/generation')).policies[0].enabled, false);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await writeFile(
      new URL('result.json', artifacts),
      JSON.stringify(
        {
          status: 'passed',
          realModel: false,
          realSms: false,
          synthetic: true,
          checks: [
            'private attachment and fixed version',
            'upload does not submit task',
            'reader property card and save',
            'selected-only send',
            'save keeps conversation',
            'unified body search',
            'five typed server candidates',
            'typed filter and verified-data renderer',
            'briefing continues conversation',
            'mobile reader',
            'one refresh entry',
            'real generation request and synthetic completion append without replacing old card',
            'generation cancellation and built-in policy pause',
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await shot('failure').catch(() => {});
    throw error;
  }
}

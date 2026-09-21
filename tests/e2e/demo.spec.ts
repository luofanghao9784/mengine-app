import { test, expect, type Page } from '@playwright/test';
const readState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1') || 'null'));
const go = (page: Page, path: string) => page.goto(`/#/${path}`);
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('首页、导航、空间概览和响应式布局均可使用', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: '智能画报', exact: true })).toBeVisible();
  for (const [label, title] of [
    ['智能画报', '智能画报'],
    ['应用', '应用'],
    ['资料库', '资料库'],
  ]) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await page.locator('.space-link').getByRole('button', { name: '销售部门工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '销售部门工作空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成员 · 3' }).click();
  await expect(page.locator('dialog[open]')).toContainText('空间负责人');
  await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document.querySelector('.topbar')!.getBoundingClientRect();
          return [...document.querySelectorAll('.topbar-actions button')].every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.top >= header.top && rect.bottom <= header.bottom;
          });
        }),
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
});

test('会话跨空间引用、移动、重命名、归档与恢复', async ({ page }) => {
  await go(page, 'chat/client');
  await page.locator('.source-chip').filter({ hasText: '服务价格表' }).click();
  await expect(page.locator('[data-deck-id="price"] .preview-location')).toContainText('财务部门工作空间');
  await page.locator('[data-deck-id="price"]').getByRole('button', { name: '关闭成果预览' }).click();
  await page.locator('.composer .context-button').click();
  await page
    .getByRole('dialog', { name: '选择工作空间' })
    .getByRole('button', { name: /财务部门工作空间/ })
    .click();
  await page.getByRole('button', { name: '确认移动' }).click();
  const s = await readState(page);
  expect(s.chats.find((c: any) => c.id === 'client').space).toBe('finance');
  expect(s.materials.find((d: any) => d.id === 'proposal').space).toBe('personal');
  await page.getByRole('button', { name: '会话选项' }).click();
  await page.getByRole('button', { name: '重命名会话' }).click();
  await page.getByLabel('会话名称').fill('新的合作方案');
  await page.getByRole('button', { name: '保存名称' }).click();
  await page.getByRole('button', { name: '会话选项' }).click();
  await page.getByRole('button', { name: '归档会话' }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await page.getByRole('button', { name: /曹鸿健 个人设置与记忆/ }).click();
  await page.getByRole('button', { name: '恢复会话' }).click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await expect(page.locator('.deck-list .thread-link').filter({ hasText: '新的合作方案' })).toBeVisible();
});

test('方案修订、版本确认、共享和个人独立修改', async ({ page }) => {
  await go(page, 'chat/client');
  await page.getByRole('button', { name: '精简表述', exact: true }).click();
  await expect(page.locator('.preview-pane')).toContainText('v3');
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  await page.getByRole('button', { name: '标记为确认版' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '发布到企业资料库', exact: true }).click();
  await page.getByLabel('查看范围').selectOption('仅空间负责人');
  await page.getByRole('button', { name: '确认发布当前版本' }).click();
  let s = await readState(page);
  const shared = s.materials.find((d: any) => d.sourceId === 'proposal' && d.space === 'sales');
  expect(shared.visibility).toBe('仅空间负责人');
  expect(s.materials.find((d: any) => d.id === 'proposal').confirmed).toBeTruthy();
  await page.getByRole('button', { name: '补充实施计划', exact: true }).click();
  s = await readState(page);
  expect(s.materials.find((d: any) => d.id === 'proposal').versions.length).toBe(4);
  expect(s.materials.find((d: any) => d.id === shared.id).versions.length).toBe(1);
  await page.reload();
  await expect(page.locator('.preview-pane')).toContainText('v4');
});

test('无权限入库申请由画报会话模拟批准，拒绝分支保留个人稿', async ({ page }) => {
  await go(page, 'chat/client');
  await page.getByRole('button', { name: '准备共享', exact: true }).click();
  await page.getByLabel('目标工作空间').selectOption('finance');
  await page.getByRole('button', { name: '确认申请入库权限' }).click();
  let s = await readState(page);
  expect(s.materials.filter((d: any) => d.sourceId === 'proposal' && d.space === 'finance')).toHaveLength(0);
  expect(s.requests).toHaveLength(1);
  await go(page, 'workbench');
  await page.locator('[data-card-id^="request:"] .briefing-card-main').first().click();
  await page.getByRole('button', { name: '模拟批准', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  s = await readState(page);
  expect(s.requests[0].status).toBe('approved');
  expect(s.materials.filter((d: any) => d.sourceId === 'proposal' && d.space === 'finance')).toHaveLength(1);
  await go(page, 'library/personal/notes');
  await page.getByRole('button', { name: '发布到企业资料库' }).click();
  await page.getByLabel('目标工作空间').selectOption('finance');
  await page.getByRole('button', { name: '确认申请入库权限' }).click();
  await go(page, 'workbench');
  await page.locator('[data-card-id^="request:"] .briefing-card-main').first().click();
  await page.getByRole('button', { name: '拒绝申请' }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  s = await readState(page);
  expect(s.requests[0].status).toBe('rejected');
  expect(s.materials.filter((d: any) => d.sourceId === 'notes')).toHaveLength(0);
});

test('梦境在会话中按新原则归类并批量处理', async ({ page }) => {
  await go(page, 'workbench');
  await page.locator('[data-card-id="dream"] .briefing-card-main').click();
  await page.getByLabel('继续对话').fill('按客户分类，报价留在原处');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '按客户', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('继续对话').fill('全部处理');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('已完成当前批次')).toBeVisible();
  await page.getByRole('button', { name: '查看整理结果' }).click();
  await expect(page.locator('.library-browser')).toContainText('客户 B');
  const s = await readState(page);
  expect(s.materials.find((d: any) => d.id === 'proposal').tags).toEqual(['客户 A']);
  expect(s.materials.find((d: any) => d.id === 'price').tags).toEqual([]);
});

test('旧工作台和仪表盘地址跳转到智能画报，空间范围保留', async ({ page }) => {
  await go(page, 'workbench');
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('智能画报');
  await expect(page.getByRole('tab', { name: '最新', exact: true })).toHaveAttribute('aria-selected', 'true');
  await go(page, 'dashboard/sales');
  await expect(page).toHaveURL(/#\/briefing\/sales$/);
  await expect(page.getByLabel('画报工作空间')).toHaveValue('sales');
  await expect(page.locator('[data-card-id="followup:sales"]')).toBeVisible();
  await expect(page.locator('[data-card-id="followup:personal"]')).toHaveCount(0);
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await expect(page.locator('[data-card-id="dream"]')).toBeVisible();
});

test('应用记录增删改与画报统计及来源明细同步', async ({ page }) => {
  await go(page, 'apps/sales/followup');
  await page.getByRole('button', { name: '新增跟进' }).click();
  await page.getByLabel('客户名称').fill('客户 G');
  await page.getByLabel('跟进内容').fill('演示新客户需求');
  await page.locator('dialog[open]').getByLabel('跟进状态').selectOption('已联系');
  await page.getByRole('button', { name: '保存跟进记录' }).click();
  await go(page, 'dashboard/personal');
  await expect(
    page.locator('[data-card-id="followup:personal"]').getByRole('img', { name: /^当前跟进记录/ }),
  ).toHaveAttribute('aria-label', /已联系 2条跟进/);
  await page.locator('[data-card-id="followup:personal"] .briefing-card-main').click();
  await page.getByRole('button', { name: '查看已联系客户', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('客户 G');
  await expect(page.getByRole('table')).not.toContainText('客户 A');
  await page.getByRole('button', { name: '编辑客户 G' }).click();
  await page.locator('dialog[open]').getByLabel('跟进状态').selectOption('已约定');
  await page.getByRole('button', { name: '保存跟进记录' }).click();
  await go(page, 'dashboard/personal');
  await expect(
    page.locator('[data-card-id="followup:personal"]').getByRole('img', { name: /^当前跟进记录/ }),
  ).toHaveAttribute('aria-label', /已约定 1条跟进/);
  await go(page, 'apps/sales/followup');
  await page.getByRole('button', { name: '删除客户 G' }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByRole('table')).not.toContainText('客户 G');
});

test('搭建应用、预览字段、保存草稿与授权发布', async ({ page }) => {
  await go(page, 'apps/all');
  await page.getByRole('button', { name: '用 AI 搭建应用' }).click();
  await page.getByLabel('应用名称').fill('合作跟进助手');
  await page.getByLabel('增加「下次跟进日期」字段').uncheck();
  await page.getByRole('button', { name: '预览表单' }).click();
  await expect(page.locator('.app-form-preview')).not.toContainText('下次跟进日期');
  await page.getByRole('button', { name: '保存个人草稿' }).click();
  await page.getByRole('button', { name: '申请共享', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  let s = await readState(page);
  const draft = s.apps.find((a: any) => a.name === '合作跟进助手');
  expect(draft.space).toBe('personal');
  expect(s.requests[0].status).toBe('pending');
  await go(page, 'workbench');
  await page.locator('[data-card-id^="request:"] .briefing-card-main').first().click();
  await page.getByRole('button', { name: '模拟批准', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await go(page, 'apps/sales');
  await expect(page.locator('.application-card').filter({ hasText: '合作跟进助手' })).toBeVisible();
  s = await readState(page);
  expect(s.apps.find((a: any) => a.id === draft.id).space).toBe('personal');
});

test('业务统计缺少来源不补零，旧配置会话仍可打开', async ({ page }) => {
  await go(page, 'dashboard/finance');
  await expect(page.locator('[data-card-id="followup:finance"]')).toHaveCount(0);
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.chats.push({
      id: 'old-dashboard',
      title: '旧配置讨论',
      space: 'finance',
      kind: 'dashboard',
      context: 'finance',
      archived: false,
      messages: [],
    });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await go(page, 'chat/old-dashboard');
  await page.reload();
  await expect(page.getByText('仪表盘已升级为智能画报', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开智能画报', exact: true }).click();
  await expect(page.getByLabel('画报工作空间')).toHaveValue('finance');
});

test('创建空间、上传资料、编辑索引、导出和资料状态', async ({ page }) => {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await page.getByRole('button', { name: '新建工作空间' }).click();
  await page.getByLabel('空间名称').fill('品牌内容');
  await page.getByLabel('空间简介').fill('内容与设计协作');
  await page.getByLabel('AI 工作说明').fill('优先使用已确认的品牌资料');
  await page.getByRole('button', { name: '创建空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '品牌内容', exact: true })).toBeVisible();
  await go(page, 'library/personal');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByLabel('选择上传文件').setInputFiles({
    name: '演示上传.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 演示上传\n这是一份本地测试资料。'),
  });
  await page.getByRole('button', { name: '确认保存资料' }).click();
  await expect(page.getByRole('heading', { name: '演示上传', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑资料' }).click();
  await page.getByLabel('简介索引').fill('更新后的索引');
  await page.getByRole('button', { name: '保存新版本' }).click();
  await page.getByRole('button', { name: '资料信息与来源' }).click();
  await page.getByRole('tab', { name: '资料属性' }).click();
  await expect(page.locator('.reader-properties')).toContainText('更新后的索引');
  await page.getByLabel('资料使用状态').selectOption('已归档');
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByLabel('资料使用状态')).toHaveValue('已归档');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出文档' }).click();
  expect((await download).suggestedFilename()).toContain('演示上传');
});

test('个人偏好、搜索、无空间会话、引用与重置', async ({ page }) => {
  await page.getByLabel('描述你的工作需求').fill('生成客户方案');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.composer .context-button')).toContainText('未归入空间');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByLabel('搜索可引用资料').fill('价格');
  await page.getByRole('checkbox', { name: /服务价格表/ }).check();
  await page.getByRole('button', { name: '引用 1 份资料' }).click();
  await expect(page.locator('.message-text').last()).toContainText('参考资料已加入');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await page
    .getByRole('region', { name: '会话列表卡片', exact: true })
    .getByRole('button', { name: '搜索会话和资料' })
    .click();
  await page.getByLabel('全局搜索').fill('价格');
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /服务价格表/ })
    .click();
  await expect(page.getByRole('heading', { name: '服务价格表', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /曹鸿健 个人设置与记忆/ }).click();
  await page.getByLabel('紧凑显示').check();
  await page.getByLabel('新增个人记忆').fill('偏好简短的实施计划');
  await page.getByRole('button', { name: '记住', exact: true }).click();
  await expect(page.locator('.memory-list')).toContainText('偏好简短的实施计划');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByRole('heading', { name: '智能画报', exact: true })).toBeVisible();
  expect((await readState(page)).memories.length).toBe(2);
});

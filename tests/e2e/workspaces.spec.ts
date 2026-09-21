import { test, expect } from '@playwright/test';

test('工作空间统一列出并保留部门名称，项目会话、资料和共享形成闭环', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  const spaces = page.getByRole('region', { name: '工作空间', exact: true });
  await expect(spaces.locator('.space-group')).toHaveCount(5);
  await expect(page.getByRole('region', { name: '项目工作空间', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '部门工作空间', exact: true })).toHaveCount(0);
  await expect(spaces.getByRole('button', { name: '销售部门工作空间', exact: true })).toBeVisible();
  await expect(spaces.getByRole('button', { name: '财务部门工作空间', exact: true })).toBeVisible();
  await spaces.getByRole('button', { name: '客户 A 交付项目', exact: true }).click();
  await expect(page.getByRole('region', { name: '项目目标与计划' })).toContainText('2026-10-09');
  await expect(page.getByRole('region', { name: '项目目标与计划' })).toContainText('实施准备');
  await page.getByRole('button', { name: '成员 · 4' }).click();
  await expect(page.locator('dialog[open]')).toContainText('周宁');
  await page.keyboard.press('Escape');
  await page.locator('.list-card').filter({ hasText: '客户 A 培训与交付计划' }).click();
  await expect(page.locator('.composer .context-button')).toContainText('客户 A 交付项目');
  await expect(page.locator('.preview-location')).toContainText('个人空间');
  await expect(page.locator('.source-row')).toContainText('财务部门工作空间');
  await page.getByRole('button', { name: '发布到企业资料库', exact: true }).click();
  await expect(page.getByLabel('目标工作空间')).toHaveValue('project-delivery');
  await page.getByRole('button', { name: '确认发布当前版本' }).click();
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(s.materials.find((d: any) => d.id === 'project-delivery-plan').versions).toHaveLength(3);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await page
    .getByRole('region', { name: '会话列表卡片', exact: true })
    .getByRole('button', { name: '新建工作空间', exact: true })
    .click();
  await expect(page.getByLabel('空间类型', { exact: true })).toHaveValue('project');
  await page.keyboard.press('Escape');
  for (const [id, title] of [
    ['project-launch', '秋季新品发布项目'],
    ['project-website', '官网改版项目'],
  ]) {
    await page.goto(`/#/space/${id}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.recent-row')).toHaveCount(3);
  }
});

test('已保存的旧演示可升级，刷新后保留修改并且不复制项目', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('描述你的工作需求').fill('保留我自己的会话');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    delete s.workspaceExamplesVersion;
    for (const collection of ['spaces', 'chats', 'materials', 'activities'])
      s[collection] = s[collection].filter((x: any) => !x.id.startsWith('project-'));
    s.spaces.find((x: any) => x.id === 'sales').name = '销售空间';
    s.spaces.find((x: any) => x.id === 'finance').name = '财务空间';
    s.materials.find((x: any) => x.id === 'proposal').summary = '用户自己的索引';
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await expect(page.locator('.deck-list .thread-link').filter({ hasText: '保留我自己的会话' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await page
    .locator('.deck-list .space-link')
    .getByRole('button', { name: '客户 A 交付项目', exact: true })
    .click();
  await page.getByRole('button', { name: '空间设置', exact: true }).click();
  await page.getByLabel('空间简介', { exact: true }).fill('这是我修改后的项目简介');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '空间设置', exact: true }).click();
  await expect(page.getByLabel('空间简介', { exact: true })).toHaveValue('这是我修改后的项目简介');
  await page.keyboard.press('Escape');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(s.spaces.filter((x: any) => x.id === 'project-delivery')).toHaveLength(1);
  expect(s.materials.find((x: any) => x.id === 'proposal').summary).toBe('用户自己的索引');
  expect(s.spaces.find((x: any) => x.id === 'finance').name).toBe('财务部门工作空间');
});

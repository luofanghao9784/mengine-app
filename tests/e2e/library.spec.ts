import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/#/library/personal');
  await page.reload();
});

test('双入口、企业文件夹、全部资料与搜索详情返回', async ({ page }) => {
  const tabs = page.getByRole('group', { name: '资料范围', exact: true });
  await expect(tabs.getByRole('button')).toHaveCount(2);
  await tabs.getByRole('button', { name: '企业资料库', exact: true }).click();
  await expect(page.getByRole('button', { name: /^打开文件夹：/ })).toHaveCount(5);
  await expect(page.locator('.library-browser')).not.toContainText('客户 A 合作方案');
  await page.getByRole('button', { name: '打开文件夹：客户 A 交付项目', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '文件夹路径' })).toHaveText('企业资料库客户 A 交付项目');
  await expect(page.locator('.library-browser')).toContainText('客户 A 实施计划');
  await page.getByRole('button', { name: '空间概览', exact: true }).click();
  await expect(page).toHaveURL(/space\/project-delivery$/);
  await page.getByRole('button', { name: /空间资料/ }).click();
  await expect(page).toHaveURL(/library\/project-delivery$/);
  await tabs.getByRole('button', { name: '企业资料库', exact: true }).click();
  await page
    .getByRole('group', { name: '企业资料视图' })
    .getByRole('button', { name: '全部资料', exact: true })
    .click();
  await expect(page.locator('.library-browser')).toContainText('服务价格表');
  await expect(page.locator('.library-browser')).not.toContainText('客户 A 合作方案');
  await page.getByLabel('搜索资料', { exact: true }).fill('实施计划');
  await page.getByRole('button', { name: '查看客户 A 实施计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '客户 A 实施计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await expect(page.getByLabel('搜索资料', { exact: true })).toHaveValue('实施计划');
  await expect(
    page
      .locator('.library-browser')
      .locator('strong')
      .filter({ hasText: /^服务价格表$/ }),
  ).toHaveCount(0);
});

test('嵌套目录、当前位置上传、刷新与浏览器回退，以及原有资料整理', async ({ page }) => {
  async function createFolder(name: string) {
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await page.getByLabel('文件夹名称').fill(name);
    await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
    await page.getByRole('button', { name: `打开文件夹：${name}`, exact: true }).click();
  }
  await createFolder('客户 A');
  await createFolder('交付文档');
  const folderURL = page.url();
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await expect(page.getByLabel('目标文件夹')).not.toHaveValue('');
  await page.getByRole('button', { name: '填入一份演示资料' }).click();
  await page.getByRole('button', { name: '确认保存资料' }).click();
  await expect(page.getByRole('navigation', { name: '文件夹路径' })).toContainText(
    '客户 A交付文档客户调研纪要',
  );
  await page.reload();
  await page.getByRole('button', { name: '返回所在文件夹' }).click();
  await expect(page).toHaveURL(folderURL);
  await expect(page.locator('.library-browser')).toContainText('客户调研纪要');
  await page
    .getByRole('navigation', { name: '文件夹路径' })
    .getByRole('button', { name: '个人空间', exact: true })
    .click();
  await page.goBack();
  await expect(page).toHaveURL(folderURL);
  await page.goto('/#/library/personal/proposal');
  await page.getByRole('button', { name: '资料信息与来源' }).click();
  await page.getByRole('button', { name: '移动到文件夹' }).click();
  await page.getByLabel('目标文件夹').selectOption({ label: '客户 A / 交付文档' });
  await page.getByRole('button', { name: '确认移动资料' }).click();
  await page.getByRole('button', { name: '返回所在文件夹' }).click();
  await expect(page.locator('.library-browser')).toContainText('客户 A 合作方案');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(s.materials.find((d: any) => d.id === 'proposal').versions).toHaveLength(2);
});

test('企业根目录要求选择位置，无维护权申请保留目录快照与个人稿', async ({ page }) => {
  await page.goto('/#/library/enterprise');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await expect(page.getByLabel('目标工作空间')).toHaveValue('');
  await page.getByRole('button', { name: '填入一份演示资料' }).click();
  await expect(page.getByRole('button', { name: '确认保存资料' })).toBeDisabled();
  await page.getByLabel('目标工作空间').selectOption('finance');
  await page.getByRole('button', { name: '确认保存资料' }).click();
  await expect(page.getByRole('navigation', { name: '文件夹路径' })).toContainText('个人空间');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(s.requests[0].target).toBe('finance');
  expect(s.requests[0].status).toBe('pending');
  expect(s.materials.some((d: any) => d.title === '客户调研纪要' && d.space === 'finance')).toBe(false);
  await page.goto('/#/library/finance');
  await expect(page.getByRole('button', { name: '新建文件夹', exact: true })).toHaveCount(0);
});

test('企业子目录发布、申请批准与个人修改分离', async ({ page }) => {
  await page.goto('/#/library/sales');
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByLabel('文件夹名称').fill('交付成果');
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
  const s = await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    s.spaces.find((x: any) => x.id === 'sales').canEdit = false;
    localStorage.setItem(key, JSON.stringify(s));
    return s;
  });
  const folder = s.folders.find((f: any) => f.space === 'sales' && f.name === '交付成果');
  await page.goto('/#/library/personal/proposal');
  await page.reload();
  await page.getByRole('button', { name: '发布到企业资料库', exact: true }).click();
  await page.getByLabel('目标文件夹').selectOption(folder.id);
  await page.getByRole('button', { name: '确认申请入库权限' }).click();
  await page.goto('/#/workbench');
  await page.locator('[data-card-id^="request:"] .briefing-card-main').first().click();
  await page.getByRole('button', { name: '模拟批准', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await page.goto(`/#/library/sales?folder=${folder.id}`);
  await expect(page.locator('.library-browser')).toContainText('客户 A 合作方案');
  await page.goto('/#/library/personal/proposal');
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.locator('dialog[open]').getByRole('textbox', { name: '正文', exact: true }).fill('新的个人内容');
  await page.getByRole('button', { name: '保存新版本' }).click();
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(
    result.materials.find((d: any) => d.sourceId === 'proposal' && d.space === 'sales').versions,
  ).toHaveLength(1);
});

test('旧数据无需重置，可见范围过滤与失效链接处理', async ({ page }) => {
  // Persist once, then emulate an older browser with no folder field.
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByLabel('文件夹名称').fill('临时目录');
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    delete s.folders;
    // The older schema predates the three demo editions and their source folders.
    delete s.briefingExamplesVersion;
    s.materials = s.materials.filter((d: any) => !d.id.startsWith('briefing-example-'));
    s.briefing.cards = s.briefing.cards.filter((c: any) => !c.id.startsWith('demo:'));
    s.materials.find((x: any) => x.id === 'proposal').summary = '保留原有修订';
    s.materials.find((x: any) => x.id === 'price').visibility = '仅空间负责人';
    s.spaces.find((x: any) => x.id === 'sales').members = [];
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator('.library-browser')).toContainText('保留原有修订');
  await page.goto('/#/library/enterprise?view=all');
  await expect(
    page
      .locator('.library-browser')
      .locator('strong')
      .filter({ hasText: /^服务价格表$/ }),
  ).toHaveCount(0);
  await expect(page.locator('.library-browser')).not.toContainText('客户 A 需求纪要');
  await page.goto('/#/library/finance/price');
  await expect(page.getByRole('heading', { name: '此位置暂不可用' })).toBeVisible();
  await page.goto('/#/library/personal?folder=missing');
  await expect(page.getByRole('heading', { name: '此位置暂不可用' })).toBeVisible();
  await page.getByRole('button', { name: '返回个人空间' }).click();
  await expect(page.locator('.library-browser')).toContainText('保留原有修订');
});

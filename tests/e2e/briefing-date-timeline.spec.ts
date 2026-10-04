import { test, expect, type Page } from '@playwright/test';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  space = uid(3),
  asOf = '2026-10-03T12:00:00Z';
const home = `/workspace/#tenant=${tenant}&view=briefing`;
const makeCard = (n: number, date: string) => ({
  cardId: uid(n),
  conversationId: uid(n + 500),
  taskId: uid(n),
  taskRevision: 1,
  attempt: 1,
  presentationVersion: 'briefing-basic-v1',
  workspaceId: space,
  workspaceName: '个人空间',
  title: `合成经营主题 ${n}`,
  excerpt: '这张卡片依据合成资料生成，用于验证日期摘要与阅读。',
  truncated: false,
  completedAt: date + 'T08:00:00Z',
  executionClass: 'live',
  engineVersion: 'synthetic',
  artifactCount: 1,
  citationCount: 0,
  originalCount: 0,
  preference: { revision: 0, pinned: n === 101, hidden: false, size: n === 101 ? 'WIDE' : 'STANDARD' },
  briefing: {
    artifactId: uid(n + 1000),
    sha256: 'a'.repeat(64),
    content: {
      schemaVersion: 'briefing-text-v1',
      businessType: 'INSIGHT',
      title: `合成经营主题 ${n}`,
      summary: '这张卡片依据合成资料生成，用于验证日期摘要与阅读。',
      analysis: ['这是具有合成来源支持的第一段完整分析。', '这是用于验证日期分组阅读的第二段完整分析。'],
      chart: null,
      source: null,
      calculationArtifactId: null,
      calculationSha256: null,
      generatedAt: date + 'T08:00:00Z',
    },
  },
});
async function fixture(
  page: Page,
  counts = [6, 2, 4],
  options: { failMore?: boolean; chart?: boolean; longText?: boolean; dates?: string[] } = {},
) {
  let visible = true,
    fail = !!options.failMore;
  const days = counts.map((total, i) => {
    const date = options.dates?.[i] ?? new Date(Date.UTC(2026, 9, 3 - i)).toISOString().slice(0, 10);
    return { date, total, cards: Array.from({ length: total }, (_, j) => makeCard(100 + i * 100 + j, date)) };
  });
  if (options.chart && days[0]?.cards[0]) {
    const content = days[0].cards[0].briefing.content as any;
    const row = {
      group: '合成门店',
      baseline: '100',
      current: '120',
      difference: '20',
      changePercent: '20',
      baselineRank: 1,
      currentRank: 1,
      issue: null,
    };
    content.schemaVersion = 'briefing-data-v1';
    content.businessType = 'DATA';
    content.source = {
      id: uid(3000),
      materialId: uid(3001),
      versionId: uid(3002),
      version: 1,
      filename: '合成表.xlsx',
      sha256: 'b'.repeat(64),
      scopeExcerpt: '合成测试范围',
    };
    content.calculationArtifactId = uid(3003);
    content.calculationSha256 = 'c'.repeat(64);
    content.chart = {
      type: 'GROUPED_BAR',
      metric: '合成收款',
      unit: '元',
      baseline: '上期',
      current: '本期',
      range: '合成两期对比',
      rows: [row],
      totals: { ...row, group: null },
    };
  }
  if (options.longText && days[0]?.cards[0]) {
    const card = days[0].cards[0];
    card.title = card.briefing.content.title = '合成门店当月收款情况待财务复核，需要持续关注确认进度';
    card.excerpt = card.briefing.content.summary =
      '2026年9月1-23日合成五店收款70000元中，待财务复核金额达40000元，占比57.1%，主要集中在合成一店和合成二店。';
  }
  const calls: URL[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    calls.push(url);
    let json: unknown;
    if (path === '/api/v1/me')
      json = {
        account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: space, name: '个人空间', kind: 'PERSONAL' }],
      };
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic' };
    else if (path.endsWith('/recommendations'))
      json = {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: [],
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 0,
        rankedCount: 0,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      };
    else if (path.endsWith('/briefing/generation')) json = { policies: [], batches: [] };
    else if (path.endsWith('/briefing/timeline')) {
      const offset = Number(url.searchParams.get('offset'));
      const all = visible ? days : [];
      json = {
        tenantId: tenant,
        zone: url.searchParams.get('zone'),
        asOf,
        items: all
          .slice(offset, offset + 20)
          .filter((d) => d.total)
          .map((d) => ({ date: d.date, total: d.total, items: d.cards.slice(0, 3) })),
        hasMore: offset + 20 < all.length,
      };
    } else if (path.includes('/briefing/timeline/')) {
      if (fail) {
        fail = false;
        return route.fulfill({ status: 503, json: { code: 'TEMPORARY_UNAVAILABLE' } });
      }
      const d = days.find((d) => path.endsWith(d.date))!,
        offset = Number(url.searchParams.get('offset'));
      const all = visible ? d.cards : [];
      json = {
        tenantId: tenant,
        view: 'LATEST',
        date: d.date,
        zone: url.searchParams.get('zone'),
        asOf,
        items: all.slice(offset, offset + 20),
        hasMore: offset + 20 < all.length,
      };
    } else if (path.includes('/tasks/')) {
      const card = days.flatMap((d) => d.cards).find((c) => path.endsWith(c.taskId));
      if (!card) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
      json = {
        conversation: {
          id: card.conversationId,
          tenantId: tenant,
          workspaceId: space,
          title: card.title,
          updatedAt: card.completedAt,
        },
        tasks: [
          {
            id: card.taskId,
            prompt: '合成分析需求',
            mode: 'AGENT',
            status: 'SUCCEEDED',
            revision: 1,
            attempt: 1,
            summaryCode: null,
            errorCode: null,
            engineVersion: 'synthetic',
            sourcesUnavailable: false,
            sources: [],
            createdAt: card.completedAt,
            reply: '这是用于验证详情返回的完整合成回复。',
            executionClass: 'live',
            modelName: 'synthetic',
            artifacts: [],
            publicQuery: null,
            webSources: [],
            skills: [],
            originals: [],
            waitReason: null,
            requiredInput: null,
            reconciliationRequired: false,
          },
        ],
        hasMore: false,
        cursor: 1,
      };
    } else if (path.endsWith('/feedback')) json = { feedback: null };
    else if (path.endsWith('/conversations'))
      json = {
        tenantId: tenant,
        enabled: true,
        agentMode: 'live',
        publicWebEnabled: false,
        items: [],
        hasMore: false,
      };
    else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    return route.fulfill({ json });
  });
  await page.goto(home);
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  return {
    days,
    calls,
    revoke: () => {
      visible = false;
    },
  };
}

async function checkFolded(day: ReturnType<Page['locator']>) {
  const grid = day.locator('.live-magazine-grid');
  await expect(grid).toHaveAttribute('data-preview-rows', '2');
  const geometry = await grid.evaluate((node) => ({
    columns: Number(getComputedStyle(node).getPropertyValue('--briefing-columns')),
    unit: parseFloat(getComputedStyle(node).getPropertyValue('--briefing-unit')),
    height: node.getBoundingClientRect().height,
    tiles: [...node.querySelectorAll<HTMLElement>('.live-briefing-tile')].map((tile) => ({
      top: tile.getBoundingClientRect().top - node.getBoundingClientRect().top,
      height: tile.offsetHeight,
    })),
  }));
  expect(geometry.columns).toBeGreaterThanOrEqual(2);
  expect(geometry.height).toBeCloseTo(geometry.unit * 2 + 10, 0);
  expect(geometry.tiles.length).toBeGreaterThan(0);
  expect(geometry.tiles.every((tile) => tile.top + tile.height <= geometry.height + 1)).toBeTruthy();
}

test('日期保留完整图表与原卡跨度，两排超出三张，最后一张叠放展开和收起', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page, [12, 2, 9], { chart: true });
  const days = page.locator('.timeline-day');
  await expect(days).toHaveCount(3);
  const first = days.first();
  await expect.poll(() => first.locator('.live-briefing-card').count()).toBeGreaterThan(3);
  await checkFolded(first);
  const chartTile = first.locator('.live-briefing-tile').first();
  await expect(chartTile).toHaveAttribute('data-size', '2×2');
  await expect(chartTile.locator('.briefing-visual-chart svg')).toBeVisible();
  const chartSize = await chartTile.boundingBox();
  expect(chartSize!.width).toBeCloseTo(chartSize!.height, 0);
  const ids = await first
    .locator('.live-briefing-card')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-conversation-id')));
  const stack = first.locator('.live-briefing-tile[data-stacked]');
  await expect(stack).toHaveCount(1);
  expect(await stack.evaluate((node) => getComputedStyle(node, '::before').transform)).not.toBe('none');
  await first.getByRole('button', { name: '展开2026-10-03全部 12 张画报', exact: true }).click();
  await expect(first.locator('.live-briefing-card')).toHaveCount(12);
  await expect(first.locator('[data-stacked]')).toHaveCount(0);
  const allIds = await first
    .locator('.live-briefing-card')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-conversation-id')));
  expect(ids.every((id) => allIds.includes(id))).toBeTruthy();
  expect(
    f.calls.some(
      (u) =>
        u.pathname.endsWith('/timeline/2026-10-03') &&
        u.searchParams.get('offset') === '3' &&
        u.searchParams.get('asOf') === asOf,
    ),
  ).toBeTruthy();
  expect((await chartTile.boundingBox())!.width).toBeCloseTo(chartSize!.width, 0);
  const card = first.locator('.live-briefing-card').last();
  await card.scrollIntoViewIfNeeded();
  await card
    .locator('.live-briefing-body')
    .evaluate((node) =>
      node.addEventListener(
        'pointerdown',
        () => node.setAttribute('data-scroll-before', String(node.closest('main')!.scrollTop)),
        { once: true },
      ),
    );
  await card.locator('.live-briefing-body').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('这是用于验证详情返回的完整合成回复。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  const before = Number(await card.locator('.live-briefing-body').getAttribute('data-scroll-before'));
  await expect
    .poll(async () => Math.abs((await page.locator('main').evaluate((n) => n.scrollTop)) - before))
    .toBeLessThan(3);
  await first.getByRole('button', { name: '收起当天卡片', exact: true }).click();
  await checkFolded(first);
  await expect(first.locator('[data-stacked]')).toHaveCount(1);
  await expect(days.nth(1).locator('.live-briefing-card')).toHaveCount(2);
  await expect(days.nth(1).locator('[data-stacked]')).toHaveCount(0);
  await page.screenshot({ path: '.local/date-two-rows/folded.png' });
});
test('一天超过一页时继续加载，网络失败可重试且不丢首批卡片', async ({ page }) => {
  await fixture(page, [26], { failMore: true });
  const day = page.locator('.timeline-day');
  await expect(day.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  await day.getByRole('button', { name: '展开2026-10-03全部 26 张画报' }).click();
  await expect(day.locator('.live-briefing-card')).toHaveCount(3);
  await day.getByRole('button', { name: '重试', exact: true }).click();
  await expect(day.locator('.live-briefing-card')).toHaveCount(23);
  await day.locator('.briefing-feed-tail').scrollIntoViewIfNeeded();
  await expect(day.locator('.live-briefing-card')).toHaveCount(26);
  const ids = await day
    .locator('.live-briefing-card')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-conversation-id')));
  expect(new Set(ids).size).toBe(26);
});
test('手机保留两列两排与卡片尺寸，区域内横向查看，权限撤销后清空', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, [6, 1]);
  const day = page.locator('.timeline-day').first();
  await expect(day.locator('.timeline-stack-open')).toBeVisible();
  await checkFolded(day);
  const scroll = day.locator('.timeline-card-scroll');
  expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const unit = await day
    .locator('.live-magazine-grid')
    .evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--briefing-unit')));
  expect(unit).toBeGreaterThan(200);
  await scroll.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await day.locator('.timeline-stack-open').click();
  await expect(day.locator('.live-briefing-card')).toHaveCount(6);
  f.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('暂时没有生成的画报', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline-day')).toHaveCount(0);
});
test('重新核对保留当天展开，加载更多卡片后仍是同一天', async ({ page }) => {
  await fixture(page, [12]);
  const day = page.locator('.timeline-day');
  await day.getByRole('button', { name: '展开2026-10-03全部 12 张画报' }).click();
  await expect(day.locator('.live-briefing-card')).toHaveCount(12);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(day.getByRole('button', { name: '收起当天卡片' })).toBeVisible();
  await expect(day.locator('.live-briefing-card')).toHaveCount(12);
});
test('按日期加载更早记录，顶部月份跟随跨月，无重复标题和不足时无叠放', async ({ page }) => {
  await fixture(page, Array(22).fill(1));
  await expect(page.locator('.timeline-day')).toHaveCount(20);
  await expect(page.locator('.workspace-edition')).toHaveText('2026年10月');
  await page.locator('.live-date-timeline > .briefing-feed-tail').scrollIntoViewIfNeeded();
  await expect(page.locator('.timeline-day')).toHaveCount(22);
  await expect(page.locator('.workspace-edition')).toHaveText('2026年9月');
  await expect(page.locator('.workspace-edition')).toHaveAttribute('datetime', '2026-09');
  await expect(page.locator('.timeline-month')).toHaveCount(0);
  await expect(page.getByText('当日画报', { exact: true })).toHaveCount(0);
  await expect(page.locator('.live-date-timeline .live-briefing-card')).toHaveCount(22);
  await expect(page.locator('.timeline-stack-open')).toHaveCount(0);
  await page.locator('main').evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.locator('.workspace-edition')).toHaveText('2026年10月');
});
test('月份使用浏览内容而非今天，跨年滚动及离开日期页重置', async ({ page }) => {
  await fixture(page, [1, 1, 1], { dates: ['2026-01-01', '2025-12-31', '2025-11-30'] });
  const edition = page.locator('.workspace-edition');
  await expect(edition).toHaveText('2026年1月');
  await expect(edition).toHaveAttribute('datetime', '2026-01');
  await page.locator('main').evaluate((node) => {
    const day = node.querySelectorAll('.timeline-day')[1];
    node.scrollTop += day.getBoundingClientRect().top - node.getBoundingClientRect().top;
  });
  await expect(edition).toHaveText('2025年12月');
  await expect(edition).toHaveAttribute('datetime', '2025-12');
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  const date = await edition.evaluate(() => new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
  await expect(edition).toHaveText(date);
});
test('只有日期栏显示年月，其他四栏显示当日日期和星期，空日期页也显示年月', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-04T04:00:00Z'));
  await fixture(page, [1]);
  const edition = page.locator('.workspace-edition');
  await expect(edition).toHaveText('2026年10月');
  for (const tab of ['推荐', '关注', '类型', '空间']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(edition).toHaveText(/^10月4日\s*星期日$/);
    await expect(edition).toHaveAttribute('datetime', '2026-10-04');
    await page.getByRole('tab', { name: '日期', exact: true }).click();
    await expect(edition).toHaveText('2026年10月');
  }
  await page.route('**/api/v1/tenants/*/briefing/timeline?*', (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        zone: 'Asia/Shanghai',
        asOf,
        items: [],
        hasMore: false,
      },
    }),
  );
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(page.getByText('暂时没有生成的画报', { exact: true })).toBeVisible();
  await expect(edition).toHaveText('2026年10月');
});
test('卡片阴影在滚动区域四周有完整余量，卡片跨度不变', async ({ page }) => {
  await fixture(page, [1], { chart: true });
  const scroll = page.locator('.timeline-card-scroll');
  const tile = scroll.locator('.live-briefing-tile').first();
  await expect(tile).toHaveAttribute('data-size', '2×2');
  await tile.hover();
  const room = await scroll.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const card = node.querySelector('.live-briefing-card')!.getBoundingClientRect();
    return { left: card.left - rect.left, top: card.top - rect.top, bottom: rect.bottom - card.bottom };
  });
  expect(room.left).toBeGreaterThanOrEqual(30);
  expect(room.top).toBeGreaterThanOrEqual(26);
  expect(room.bottom).toBeGreaterThanOrEqual(30);
});
test('下拉刷新只读取日期接口并保留当天展开', async ({ page }) => {
  const f = await fixture(page, [12]);
  const day = page.locator('.timeline-day');
  await day.getByRole('button', { name: '展开2026-10-03全部 12 张画报' }).click();
  await expect(day.locator('.live-briefing-card')).toHaveCount(12);
  await page.locator('main').evaluate((node) => {
    node.scrollTop = 0;
  });
  const before = f.calls.filter((u) => u.pathname.endsWith('/briefing/timeline')).length;
  await page.locator('.timeline-day-heading').hover();
  await page.mouse.wheel(0, -220);
  await expect
    .poll(() => f.calls.filter((u) => u.pathname.endsWith('/briefing/timeline')).length)
    .toBeGreaterThan(before);
  await expect(page.locator('#live-briefing-panel')).toHaveAttribute('data-refresh-phase', 'idle');
  await expect(day.getByRole('button', { name: '收起当天卡片' })).toBeVisible();
  await expect(day.locator('.live-briefing-card')).toHaveCount(12);
});

test('窄窗口展开前后都保留2×2图表，不为填空改成1×2', async ({ page }) => {
  await page.setViewportSize({ width: 949, height: 841 });
  await fixture(page, [2], { chart: true });
  const day = page.locator('.timeline-day');
  for (const width of [949, 390]) {
    await page.setViewportSize({ width, height: 841 });
    await expect(day.locator('.timeline-stack-open')).toBeVisible();
    await checkFolded(day);
    const chart = day.locator('.live-briefing-tile').first();
    await expect(chart).toHaveAttribute('data-size', '2×2');
    const before = await chart.boundingBox();
    expect(before!.width).toBeCloseTo(before!.height, 0);
    await day.locator('.timeline-stack-open').click();
    await expect(day.locator('.live-briefing-card')).toHaveCount(2);
    await expect(chart).toHaveAttribute('data-size', '2×2');
    const after = await chart.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 0);
    expect(after!.height).toBeCloseTo(before!.height, 0);
    await day.getByRole('button', { name: '收起当天卡片', exact: true }).click();
  }
});

test('文字卡按完整摘要测量，不因先省略文字缩成一格高', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page, [1], { longText: true });
  const tile = page.locator('.timeline-day .live-briefing-tile');
  await expect(tile).toHaveAttribute('data-size', '1×2');
  await expect(tile.locator('.magazine-summary')).toContainText('合成一店和合成二店');
  expect(
    await tile.locator('.magazine-summary').evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBeTruthy();
});

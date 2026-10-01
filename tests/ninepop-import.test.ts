import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, get } from 'node:http';
import { createNinepopSeed, NINEPOP_STORAGE_KEY } from '../src/ninepop/adapter.ts';
import { loadNinepopSession } from '../src/ninepop/session.ts';
import { replyNinepop } from '../src/ninepop/reply.ts';
import { interleaveNinepopNews } from '../src/ninepop/editorial.ts';
import { briefingEntry } from '../src/briefingLifecycle.ts';
import { externalAppUrl } from '../src/ninepop/externalApp.ts';
import { privateDemoHandler } from '../scripts/ninepop/private-data.ts';
import { syncBriefing, openBriefingChat } from '../src/briefing.ts';
import type { NinepopPackage } from '../src/ninepop/types.ts';

function fixture(): NinepopPackage {
  return {
    schema_version: 1,
    dataset_id: 'synthetic-test-only',
    generated_at: '2026-09-24T12:00:00+08:00',
    spaces: ['经营总览', '制度与品牌', '资讯观察'],
    suggested_first_screen: ['test-C01'],
    materials: [
      {
        id: 'test-source',
        title: '合成取数依据',
        content: '合成测试资料，无生产数据',
        boundary: '仅测试',
        status: '使用中',
      },
    ],
    cards: Array.from({ length: 30 }, (_, i) => ({
      id: `test-C${String(i + 1).padStart(2, '0')}`,
      type: i === 0 ? '数据' : '洞察',
      space: '经营总览',
      title: `合成测试卡${i + 1}`,
      summary: '合成摘要',
      generated_at: '2026-09-24T12:00:00+08:00',
      data_period: '合成时间段',
      priority: 'P2',
      facts: ['合成事实'],
      ai_analysis: '合成判断',
      recommended_actions: ['合成建议'],
      boundaries: ['不用于经营决策'],
      source_refs: ['test-source'],
      suggested_owner_role: '测试角色',
      execution_status: '建议未执行',
      data:
        i === 0
          ? [
              { period: '2026-09', name: '测试店', receipts_yuan: '120' },
              { period: '2026-08', name: '测试店', receipts_yuan: '100' },
            ]
          : [],
    })),
  };
}
test('import keeps all cards, full evidence and actual comparison units, without generic fixtures', () => {
  const state = syncBriefing(createNinepopSeed(fixture()));
  assert.equal(state.briefing?.cards.length, 30);
  assert.equal(state.materials.length, 31);
  assert.equal(state.records.length, 0);
  assert.deepEqual(state.briefing!.cards[0].data.presentation?.chart?.rows, [
    { label: '测试店', value: 120, previous: 100 },
  ]);
  assert.ok(
    state.briefing!.cards.every((c) => c.data.refs!.every((id) => state.materials.some((d) => d.id === id))),
  );
  assert.ok(state.briefing!.cards[0].data.article?.sections.some((s) => s.heading === '阅读说明'));
  const bad = fixture();
  bad.cards[0].source_refs = ['missing'];
  assert.throws(() => createNinepopSeed(bad), /缺少来源/);
});
test('session restore cannot replace server evidence or inherit another tenant fixture', () => {
  const seed = createNinepopSeed(fixture());
  const unrelated = { schema: 1, scenario: 'konggu', chats: [{ id: 'wrong' }] };
  const restored = loadNinepopSession(seed, {
    getItem(key) {
      assert.equal(key, NINEPOP_STORAGE_KEY);
      return JSON.stringify(unrelated);
    },
  });
  assert.equal(restored.chats.length, 0);
  const changed = structuredClone(seed);
  changed.materials = [];
  changed.ninepop!.cards = [];
  assert.equal(loadNinepopSession(seed, { getItem: () => JSON.stringify(changed) }).materials.length, 31);
});
test('card follow-up retrieves fixed evidence and declares no live call or execution', () => {
  const bundle = fixture();
  for (let i = 0; i < 3; i++) {
    const id = `extra-source-${i}`;
    bundle.materials.push({ ...bundle.materials[0], id });
    bundle.cards[0].source_refs.push(id);
  }
  const state = syncBriefing(createNinepopSeed(bundle));
  const id = openBriefingChat(state, 'test-C01', 'content');
  const chat = state.chats.find((c) => c.id === id)!;
  replyNinepop(state, chat, '解释依据');
  assert.match(chat.messages.at(-1)!.text, /未调用实时模型或9POP接口/);
  assert.match(chat.messages.at(-1)!.text, /合成事实/);
  assert.equal(chat.messages.at(-1)!.refs?.[0], 'ninepop-analysis-test-C01');
  state.spaces.forEach((s) => (s.members = []));
  replyNinepop(state, chat, '解释依据');
  assert.doesNotMatch(chat.messages.at(-1)!.text, /合成事实/);
});
test('external backend link cannot become a script, token URL or unverified domain', () => {
  const app = createNinepopSeed(fixture()).apps[0];
  assert.equal(externalAppUrl(app), 'https://boss.9pop.top/');
  for (const url of [
    'javascript:alert(1)',
    'https://boss.9pop.top/?token=x',
    'https://boss.9pop.top.evil.test/',
  ])
    assert.equal(externalAppUrl({ ...app, external: { url } }), undefined);
});
test('private HTTP endpoint denies disabled, cross-origin and headerless access and strips registry paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ninepop-synthetic-'));
  const bundle = fixture();
  writeFileSync(
    join(dir, '03-36张卡片数据.json'),
    JSON.stringify({ ...bundle, secretPath: '/synthetic/private' }),
  );
  writeFileSync(join(dir, '09-资料阅读内容.json'), JSON.stringify({ materials: bundle.materials }));
  let enabled: string | undefined = dir;
  const server = createServer((req, res) =>
    privateDemoHandler(enabled)(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/__private-demo/ninepop`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal(
      (await fetch(url, { headers: { 'X-Dreamcore-Local-Demo': '1', Origin: 'https://untrusted.example' } }))
        .status,
      403,
    );
    const wrongHost = await new Promise<number | undefined>((resolve) =>
      get(url, { headers: { 'X-Dreamcore-Local-Demo': '1', Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }),
    );
    assert.equal(wrongHost, 403);
    const allowed = await fetch(url, { headers: { 'X-Dreamcore-Local-Demo': '1' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await allowed.text(), /secretPath|synthetic\/private/);
    enabled = undefined;
    assert.equal((await fetch(url, { headers: { 'X-Dreamcore-Local-Demo': '1' } })).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('edited news refreshes in place while reading preferences and custom titles survive', () => {
  const bundle = fixture();
  bundle.cards[29].type = '资讯';
  const cached = syncBriefing(createNinepopSeed(bundle));
  const news = cached.briefing!.cards[29];
  news.pinned = true;
  news.config = { title: news.data.title, size: '2×2', compact: false };
  cached.briefing!.cards[1].config = { title: '用户自己的标题', size: '1×2', compact: false };
  bundle.cards[29].title = '编辑后的资讯';
  bundle.cards[29].editorial = {
    source_label: '合成新闻来源',
    display_date: '9月1日',
    date: '2026-09-01',
    photo: {
      src: 'https://example.com/news.jpg',
      alt: '合成图',
      credit: '测试',
      sourceUrl: 'https://example.com/article',
    },
  };
  const restored = loadNinepopSession(createNinepopSeed(bundle), { getItem: () => JSON.stringify(cached) });
  const updated = restored.briefing!.cards[29];
  assert.equal(updated.pinned, true);
  assert.equal(updated.data.title, '编辑后的资讯');
  assert.equal(updated.config!.title, '编辑后的资讯');
  assert.equal(updated.data.photo!.src, 'https://example.com/news.jpg');
  assert.equal(updated.createdAt, news.createdAt);
  assert.equal(restored.briefing!.cards[1].config!.title, '用户自己的标题');
});
test('news is spread through a recommendation group without rewriting source dates or business priority', () => {
  const bundle = fixture();
  bundle.cards.slice(-6).forEach((card) => {
    card.type = '资讯';
  });
  const state = syncBriefing(createNinepopSeed(bundle));
  const entries = state.briefing!.cards.map((card) => briefingEntry(card)!);
  const spread = interleaveNinepopNews(entries);
  assert.equal(spread.length, entries.length);
  assert.equal(new Set(spread.map((e) => e.card.id)).size, entries.length);
  assert.equal(spread[3].data.sourceKind, 'news');
  assert.deepEqual(
    spread.filter((e) => e.data.sourceKind !== 'news'),
    entries.slice(0, -6),
  );
  assert.deepEqual(
    spread.filter((e) => e.data.sourceKind === 'news'),
    entries.slice(-6),
  );
  assert.equal(spread[3].at, entries[24].at);
});

test('varied charts keep comparison values, real conversion stages and currency units', () => {
  const bundle = fixture();
  bundle.cards[15].data = [
    { name: '测试甲店', activated_cards: '8', converted_within_30d: '2' },
    { name: '测试乙店', activated_cards: '2', converted_within_30d: '0' },
  ];
  bundle.cards[17].data = [{ paid_formal_orders: '9', orders_with_prior_paid_order: '3' }];
  bundle.cards[19].data = [{ name: '测试甲店', received_cents: '60001', contract_cents: '100001' }];
  const state = createNinepopSeed(bundle);
  const plot = (id: string) => state.ninepop!.cards.find((c) => c.id === id)!.presentation!.chart!;
  assert.equal(plot('test-C01').kind, 'columns');
  assert.deepEqual(plot('test-C16').rows, [
    { label: '开通体验', value: 10 },
    { label: '30天内购课', value: 2 },
  ]);
  assert.deepEqual(plot('test-C16').series, [
    { label: '测试甲店', values: [8, 2] },
    { label: '测试乙店', values: [2, 0] },
  ]);
  assert.equal(plot('test-C18').kind, 'unit-grid');
  assert.deepEqual(
    plot('test-C18').rows.map((r) => r.value),
    [3, 6],
  );
  assert.deepEqual(plot('test-C20').rows, [{ label: '测试甲店', value: 600.01, previous: 1000.01 }]);
  assert.equal(new Set(state.ninepop!.cards.flatMap((c) => c.presentation?.chart?.kind || [])).size, 7);
});

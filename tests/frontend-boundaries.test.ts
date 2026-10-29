import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cruise } from 'dependency-cruiser';

const require = createRequire(import.meta.url);
const config = require('../.dependency-cruiser.cjs');
const allowlist = require('../config/frontend-boundary-allowlist.cjs');

const RULES = new Set(['d1-live-not-to-demo', 'd2-shared-not-session', 'feature-not-to-foreign-page']);

type AllowedEdge = {
  from: string;
  to: string;
  rule: { name: string; severity: string };
  comment?: string;
};

type FoundEdge = {
  from: string;
  to: string;
  rule: { name: string };
};

const edgeKey = (rule: string, from: string, to: string) => `${rule}\n${from}\n${to}`;

test('前端模块边界只放行允许清单里的存量边', async () => {
  const edges = allowlist as AllowedEdge[];
  const allowed = new Map<string, AllowedEdge>();
  for (const edge of edges) {
    assert.ok(RULES.has(edge.rule.name), `未知规则：${edge.rule.name}`);
    assert.equal(edge.rule.severity, 'error');
    assert.ok(
      edge.comment && edge.comment.startsWith('ADR'),
      `条目缺少 ADR 条款注释：${edge.from} -> ${edge.to}`,
    );
    const key = edgeKey(edge.rule.name, edge.from, edge.to);
    assert.equal(allowed.has(key), false, `允许清单重复：${edge.rule.name} ${edge.from} -> ${edge.to}`);
    allowed.set(key, edge);
  }

  const result = await cruise(['src'], {
    ...config.options,
    ruleSet: { forbidden: config.forbidden },
    validate: true,
    outputType: 'json',
  });
  const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
  assert.ok(output.summary.totalCruised > 400, '没有扫到 src 下的 TypeScript 模块，门禁会漏报');

  const unresolved: string[] = [];
  for (const mod of output.modules) {
    for (const dependency of mod.dependencies ?? []) {
      const specifier = dependency.module ?? '';
      if (
        dependency.couldNotResolve &&
        specifier.startsWith('.') &&
        !specifier.endsWith('.css') &&
        !specifier.endsWith('.svg')
      ) {
        unresolved.push(`${mod.source} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(
    unresolved,
    [],
    `有相对导入没有解析到文件，对应的违规边会被漏掉：\n${unresolved.join('\n')}`,
  );

  const found = new Map<string, FoundEdge>();
  for (const violation of output.summary.violations as FoundEdge[]) {
    if (violation.rule.name === 'feature-not-to-foreign-page') {
      assert.notEqual(
        violation.from.split('/')[1],
        violation.to.split('/')[1],
        `同一 feature 内部引用自己的页面不应违规：${violation.from} -> ${violation.to}`,
      );
    }
    found.set(edgeKey(violation.rule.name, violation.from, violation.to), violation);
  }

  const fresh = [...found.keys()].filter((key) => !allowed.has(key)).sort();
  const stale = [...allowed.keys()].filter((key) => !found.has(key)).sort();
  const lines: string[] = [];
  if (fresh.length > 0) {
    lines.push('清单外的新边。不要把它们追加进允许清单来过门禁，应改依赖方向：');
    for (const key of fresh) {
      const edge = found.get(key)!;
      lines.push(`  ${edge.rule.name}  ${edge.from} -> ${edge.to}`);
    }
  }
  if (stale.length > 0) {
    lines.push('允许清单里已经不存在的边。同一变更从 config/frontend-boundary-allowlist.cjs 删除：');
    for (const key of stale) {
      const edge = allowed.get(key)!;
      lines.push(`  ${edge.rule.name}  ${edge.from} -> ${edge.to}`);
    }
  }
  assert.equal(fresh.length + stale.length, 0, `\n${lines.join('\n')}\n`);
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const hook = fileURLToPath(new URL('../.githooks/pre-push', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dreamcore-hook-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const env = { ...process.env, DREAMCORE_ALLOW_MAIN_PUSH: '' };
// 不继承外部 Git 仓库位置或身份注入，所有测试写入临时仓库。
for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
git('init', '-b', 'main');
git('config', 'user.name', 'Hook Test');
git('config', 'user.email', 'hook-test@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('config', 'core.hooksPath', join(dir, 'no-hooks'));
writeFileSync(join(dir, 'sample.txt'), 'first\n');
git('add', 'sample.txt');
git('commit', '-m', 'first');
const first = git('rev-parse', 'HEAD');
writeFileSync(join(dir, 'sample.txt'), 'second\n');
git('add', 'sample.txt');
git('commit', '-m', 'second');
const second = git('rev-parse', 'HEAD');
const zero = '0'.repeat(first.length);
const update = (local, remote, ref = 'refs/heads/main') => `refs/heads/task ${local} ${ref} ${remote}\n`;
const run = (input, allow = false) => spawnSync('sh', [hook], {
  cwd: dir, input, encoding: 'utf8',
  env: { ...env, DREAMCORE_ALLOW_MAIN_PUSH: allow ? '1' : '' },
});

test('普通任务分支允许推送', () => assert.equal(run(update(second, zero, 'refs/heads/codex/task')).status, 0));
test('main 首次创建默认拦截', () => assert.notEqual(run(update(first, zero)).status, 0));
test('显式初始化允许创建 main', () => assert.equal(run(update(first, zero), true).status, 0));
test('main 快进默认仍需 PR', () => assert.notEqual(run(update(second, first)).status, 0));
test('显式人工集成允许快进 main', () => assert.equal(run(update(second, first), true).status, 0));
test('显式开关也不能非快进更新 main', () => assert.notEqual(run(update(first, second), true).status, 0));
test('显式开关也不能删除 main', () => assert.notEqual(run(update(zero, second), true).status, 0));
test('远端提交未知时拒绝放行', () => assert.notEqual(run(update(second, '1'.repeat(first.length)), true).status, 0));
test('批量推送中 main 保护仍生效', () => assert.notEqual(run(update(second, zero, 'refs/heads/codex/task') + update(first, second), true).status, 0));

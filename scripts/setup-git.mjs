import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) {
  throw new Error('请在完整的梦核工作空间 Git 仓库中启用协作配置。');
}
git('config', '--local', 'core.hooksPath', '.githooks');
git('config', '--local', 'pull.ff', 'only');
git('config', '--local', 'push.default', 'simple');
console.log('已启用当前仓库的 Git 钩子、快进拉取与 simple 推送；未修改全局配置。');

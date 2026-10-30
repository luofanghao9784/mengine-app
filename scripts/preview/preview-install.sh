#!/usr/bin/env bash
# 安装：预检 → 依赖安装（仅仓库内 node_modules）→ 构建（commit 未变则跳过）→ 建私有目录。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
# 不执行 brew install（只给指引）；不默认安装 parser venv（fail closed）。幂等。
# 用法：preview-install.sh [--dry-run] [--with-parser] [--force-build]
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
WITH_PARSER=0; FORCE=0
for a in "$@"; do case "$a" in --with-parser) WITH_PARSER=1;; --force-build) FORCE=1;; --dry-run) ;; *) die "未知参数 $a";; esac; done
mkpriv "$PREVIEW_HOME"; for d in "$SECRETS" "$LOGS" "$BACKUPS" "$STATE"; do mkpriv "$d"; done
bash "$(dirname "$0")/preview-doctor.sh" || { [ "$DRY_RUN" = 1 ] && log "[dry-run] doctor 未通过，真跑时此处中止" || die "doctor 未通过"; }
detect_java || true; detect_pg_bin || true
head="$(cd "$REPO" && git rev-parse HEAD)"
stamp="$STATE/build-commit"
if [ "$FORCE" = 0 ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$head" ] && [ -f "$REPO/apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar" ] && [ -f "$REPO/dist/index.html" ]; then
  log "构建产物与 HEAD $head 一致，跳过构建"
elif [ "$FORCE" = 0 ] && [ -f "$REPO/apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar" ] && [ -f "$REPO/engine/dist/main.js" ] && [ -z "$(cd "$REPO" && git status --porcelain --untracked-files=no)" ] && [ "${PREVIEW_TRUST_EXISTING_BUILD:-0}" = 1 ]; then
  log "PREVIEW_TRUST_EXISTING_BUILD=1：复用已有构建产物（共享电脑自测用，避免改写共享工作树）"
  [ "$DRY_RUN" = 1 ] || echo "$head" > "$stamp"
else
  run bash -c "cd '$REPO' && npm ci --no-audit --no-fund"
  run bash -c "cd '$REPO' && npm --prefix engine ci --no-audit --no-fund"
  run bash -c "cd '$REPO' && npm run trial:build"
  [ "$DRY_RUN" = 1 ] || echo "$head" > "$stamp"
fi
if [ "$WITH_PARSER" = 1 ]; then
  run bash -c "cd '$REPO' && python3 scripts/knowledge/setup.py"
else
  log "未安装 parser venv：start 默认 --parser off，与本机 .venv 无关（fail closed）"
  [ -e "$REPO/workers/parser/.venv" ] && log "提示：工作树已有 workers/parser/.venv；start 仍默认 --parser off，与本机 .venv 无关"
fi
log "安装完成。下一步：preview-start.sh"

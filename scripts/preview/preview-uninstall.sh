#!/usr/bin/env bash
# 卸载：停止 → 默认先 pg_dump 备份（0600）→ 删除 PREVIEW_HOME 下的实例/密钥/日志。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
# 绝不 brew uninstall、不动用户已有 brew 包/系统 PG、不删仓库。需要 --yes 才真删。
# 用法：preview-uninstall.sh [--dry-run] [--yes] [--no-backup] [--keep-backups]
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
YES=0; BACKUP=1; KEEP=1
for a in "$@"; do case "$a" in --yes) YES=1;; --no-backup) BACKUP=0;; --purge-backups) KEEP=0;; --dry-run|--keep-backups) ;; *) die "未知参数 $a";; esac; done
[ -d "$PREVIEW_HOME" ] || { log "无预览目录，无需卸载"; exit 0; }
if [ "$DRY_RUN" = 1 ]; then run bash "$(dirname "$0")/preview-stop.sh" --dry-run; else bash "$(dirname "$0")/preview-stop.sh"; fi
if [ "$BACKUP" = 1 ] && [ -d "$INSTANCE/postgres" ]; then
  # trial 自带 backup.py 只对已停止实例备份（含 pg 数据与密码散列），输出 0600；密钥文件单独保存
  run bash -c "cd '$REPO' && umask 077 && python3 scripts/local/backup.py create --directory '$INSTANCE' --output '$BACKUPS/preview-$(date +%Y%m%d-%H%M%S).bundle'"
  # Integrity is not recoverability: current recovery needs the source lineage and rejects newer coverage.
  # Do not delete the only source merely because pg_dump/verify completed. No automatic --no-backup fallback.
  if [ "$DRY_RUN" != 1 ]; then
    die "备份已生成，但当前受支持恢复仍依赖原实例且覆盖未完成；默认卸载保留实例、密钥、登记证据与备份，未执行删除。"
  fi
fi
[ "$YES" = 1 ] || { log "未带 --yes：只打印将删除的内容"; DRY_RUN=1; }
for d in "$INSTANCE" "$SECRETS" "$LOGS" "$STATE"; do run rm -rf "$d"; done
[ "$KEEP" = 0 ] && run rm -rf "$BACKUPS"
log "卸载完成（未卸载任何 brew 包；备份保留于 ${BACKUPS}，除非 --purge-backups）"

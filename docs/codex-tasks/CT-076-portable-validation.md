# CT-076 可移交驱动与修复后独立复验

原始红证据已经完成，不重复运行基线。质量性能负责后端固定补丁到达后的同条件独立复验；后端提交 SHA/完整 diff 未到达前，不称修复通过。现有 general 长耗时、其他错误族、真实 parser/calculator 沙箱能力仍独立未决。

## 材料、范围与变更说明

- `docs/codex-tasks/ct076-cross-jvm.py` 是完整、无秘密、独立源码。由原已实际使用的 cross-jvm 驱动适配：cwd 改为调用者的源码仓库；结果目录和完整 SHA 必填；Maven `-s` 可选；保存每步命令、退出码和 Surefire；快照同时观察 wrapper 自有 `dreamcore_test` 及其隔离数据库。测试命令、原 selector 与断言不修改，不执行生产 SQL 写入或全表清理。
- 这版移交驱动仅做编译、`--help` 和静态审查，没有重新执行原15次基线。后端补丁到达后使用此驱动复验；历史实际 argv/结果仍以 d88da84 的 evidence.json 为准，不覆盖或改写。
- 仅在已授权 Linux 云端/CI执行，禁止在老板本地 Mac 执行；不操作预览副本。材料仓库与源代码仓库分别新建，公共读取无需 gh 登录，不使用审核账号提交。
- Java21、Node24.20.0、PG18为前提。自带 PG 发行包若需 `LD_LIBRARY_PATH`，由执行人本地设置，不将网络代理或凭证写入仓库。Maven默认不用 `-s`，仅需网络设置时通过 `CT076_MAVEN_SETTINGS` 指定可读本地文件。

## 独立副本准备

先从本次交付消息取完整材料提交 SHA；`CT076_SOURCE_SHA` 必须是后端已交付的完整修复 SHA。对原有红基线的 head/merge 不做混用：head=`3e450e72660eda88498d4719e17f84a7a335f380`；原 CI merge=`3e6bdc740955b06ce6f5b250b43fb600d359104a`；base=`d945af9235b07ecfbfc4990bd6c4ebae4324b769`。后端基线与补丁父关系仍需检查完整 diff，不自动继承旧绿。

以下代码在同一 Bash 会话按顺序执行。两个 SHA 是交付版本参数，不是凭证；未得到补丁时只准备材料，不猜 SHA。

```bash
set -euo pipefail
[[ $(uname -s) == Linux ]]
: "${CT076_MATERIAL_SHA:?从交付消息设置完整材料SHA}"
: "${CT076_SOURCE_SHA:?从后端交付设置完整修复SHA}"
[[ $CT076_MATERIAL_SHA =~ ^[0-9a-f]{40}$ && $CT076_SOURCE_SHA =~ ^[0-9a-f]{40}$ ]]
CT076_WORK=$(mktemp -d "${TMPDIR:-/tmp}/ct076-fix-validation.XXXXXXXX")
printf 'Evidence root: %s\n' "$CT076_WORK"
git clone --no-checkout https://github.com/luofanghao9784/mengine-app.git "$CT076_WORK/materials"
git -C "$CT076_WORK/materials" fetch --no-tags origin "$CT076_MATERIAL_SHA"
git -C "$CT076_WORK/materials" checkout --detach "$CT076_MATERIAL_SHA"
git clone --no-checkout https://github.com/luofanghao9784/mengine-app.git "$CT076_WORK/source"
git -C "$CT076_WORK/source" fetch --no-tags origin "$CT076_SOURCE_SHA"
git -C "$CT076_WORK/source" checkout --detach "$CT076_SOURCE_SHA"
cd "$CT076_WORK/source"
[[ $(git rev-parse HEAD) == "$CT076_SOURCE_SHA" ]]
[[ -z $(git status --short) ]]
mkdir "$CT076_WORK/artifacts"
export CI=true NODE_ENV=test
export MAVEN_USER_HOME="$CT076_WORK/maven-home"
export MAVEN_OPTS="-Dmaven.repo.local=$CT076_WORK/maven-repository"
export npm_config_cache="$CT076_WORK/npm-cache"
export POSTGRES_BIN=${POSTGRES_BIN:-/usr/lib/postgresql/18/bin}
java -version
node --version
[[ $(node --version) == v24.20.0 ]]
for tool in initdb pg_ctl psql; do "$POSTGRES_BIN/$tool" --version; done
# 核验输出为Java21/PG18；Maven还需实际使用同一Java21（JAVA_HOME/PATH应一致）。
```

## 逐条记录及最小正反序

每个 `step` 创建不可覆盖的新目录，先保存退出码和日志再返回；驱动还会逐类保存 fresh Surefire 与队列身份，不将旧 XML 计作新执行。每个 `validate` 调用由原 wrapper 创建并销毁一个新 PG 集群；同一次调用的两个 Maven JVM 使用同一个临时库，反序另起新库。修复若在类内创建隔离库，驱动会分别记录这些库的队列，不把主库为空冒充隔离库无残留。

```bash
step() {
  local name=$1 rc=0
  shift
  local out="$CT076_WORK/artifacts/$name"
  mkdir "$out" || return 125
  printf '%q ' "$@" > "$out/argv.txt"
  printf '\n' >> "$out/argv.txt"
  date -u +%FT%TZ > "$out/started_at.txt"
  "$@" > "$out/output.log" 2>&1 || rc=$?
  printf '%s\n' "$rc" > "$out/exit-code.txt"
  date -u +%FT%TZ > "$out/completed_at.txt"
  printf '%s exit=%s\n' "$name" "$rc"
  return "$rc"
}
step engine-install npm ci --prefix engine
step engine-build npm run build --prefix engine
MAVEN_SETTINGS_ARGS=()
if [[ -n ${CT076_MAVEN_SETTINGS:-} ]]; then
  [[ -r "$CT076_MAVEN_SETTINGS" ]]
  MAVEN_SETTINGS_ARGS=(--maven-settings "$CT076_MAVEN_SETTINGS")
fi
NATIVE='NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions'
KNOWLEDGE='KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse'
TABLE='TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted'
validate() {
  local name=$1
  shift
  step "$name" timeout --signal=TERM --kill-after=20s 600s \
    python3 scripts/with-test-postgres.py \
    python3 ../materials/docs/codex-tasks/ct076-cross-jvm.py \
      --expected-sha "$CT076_SOURCE_SHA" \
      --results "$CT076_WORK/artifacts/$name-classes" \
      "${MAVEN_SETTINGS_ARGS[@]}" "$@"
}
failed=0
validate native-knowledge "$NATIVE" "$KNOWLEDGE" || failed=1
validate knowledge-native "$KNOWLEDGE" "$NATIVE" || failed=1
validate native-table "$NATIVE" "$TABLE" || failed=1
validate table-native "$TABLE" "$NATIVE" || failed=1
git diff --check
git status --short > "$CT076_WORK/artifacts/final-source-status.txt"
printf '%s\n' "$failed" > "$CT076_WORK/artifacts/overall-exit.txt"
printf 'Overall result=%s; artifacts=%s\n' "$failed" "$CT076_WORK/artifacts"
# 保留整个目录和全部失败，不循环重试；在独立脚本执行时最后使用 exit "$failed"。
```

600秒是原最小诊断的外层停止边界，不修改 workflow 90分钟上限。超时退出124只代表本次诊断未完成，不能算测试通过；部分 XML 必须标记部分性。若命令被信号打断，保留输出和已有报告后停止，不自动重跑。四组都通过也只说明此修复范围通过，不能认定完整 rest/general 通过。

## 独立未决项的最小范围

以下是后续单独诊断的精确入口，本轮未执行，不与四组队列修复混在一起，也不因缺bwrap阻塞四组。仍用上面的 `validate` 保留退出码/Surefire、原断言和独立数据库：

```bash
# general最后开始类的一个明确方法；不是声称它就是原run卡住的方法。
validate general-suggestion-one \
 'GeneralExperienceSuggestionIntegrationTest#explicitScopePrivateIdempotentInputAndFixedGeneralVersion'
# 真实解析/计算：仅原workflow OS隔离及parser依赖准备完成、探针通过后执行。
bwrap --unshare-all --die-with-parent --ro-bind / / --proc /proc --dev /dev /bin/true
systemctl --user is-system-running
validate parser-real-one 'KnowledgeIntegrationTest#realTextParseSearchAndImmutableCitation'
validate calculator-real-one \
 'TableCalculationIntegrationTest#exactPinnedVersionHasIdempotentPrivateReceiptAndRemainsDownloadableOnlyAfterFinish'
```

当前执行端bwrap原始退出1为`Failed to make / slave: Operation not permitted`，user-systemd退出1为offline；这些真实parser/calculator方法尚未在此条件下运行。原工作流的parser venv/OCR/systemd/cgroup等前提还须按固定workflow准备；探针通过也不等于所有依赖齐全。general单方法须保留启动/迁移与方法耗时，不能以新库一次快或慢解释原整片耗时。禁止放宽生产权限、删断言/跳过、扩大超时、重跑整片、合并部署或向老板本地Mac写入。

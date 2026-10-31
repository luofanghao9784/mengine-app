# CT-092：本地备份默认迁移枚举一致性

认领#92；叠加#90固定head1aac85b32d0186101713cee998b646734efc80b1。本任务不改迁移SQL、业务权限、来源登记、签名、有效期或恢复coverage；不接触生产/用户数据、现有云预览或用户本地Mac，不合并部署。

## 原始失败与定位

原run https://github.com/luofanghao9784/mengine-app/actions/runs/41167525344/job/124438211446 已完整读取。实际Bash3.2.57，stop成功，04:13:32Z调用backup.py create，04:13:33Z报“数据库迁移与当前工作树不完全一致，不能声明完整备份或恢复。”exit1；残留检查成功不能当卸载通过。

固定源码默认Flyway为db/migration + db/migration-common；trial local profile没有覆盖此配置。默认134份SQL，加common44份，总178份。backup.migrations/schema_hash和trial.verify_api_migrations原本只检查migration134份，是明确源码缺陷。CI临时history和当时完整jar未保存于现有5文件日志artifact，不能把合成重现当原CI逐行history证据。migration-local是另一独立兼容谱系，绝不自动混入。

## 最小实现

trial.api_migration_files统一默认两目录按数字版本全局排序，缺目录/空目录/重复版本拒绝。backup清单及摘要调用统一枚举；manifest行仍为version/script/sha256。JAR按目录相对路径比较两处SQL字节，缺失/额外/陈旧common/重复ZIP条目都拒绝。旧的合成集成夹具改为从统一真实路径加载，不放宽断言。原运行时JAR单测夹具补全common；新增正负测试。

## 可复制检查

在独立合法分支及已允许云端CLI执行：

```sh
python3 -m unittest discover -s tests/local -p backup_migrations_test.py -v
python3 -m unittest discover -s tests/local -p backup_test.py -v
RUN_BACKUP_DB_TESTS=1 PYTHONPATH=tests/local python3 -m unittest backup_migrations_test.ActualMigrationBackupTest -v
./apps/api/mvnw -B -f apps/api/pom.xml -DskipTests package
git diff --check
```

PG18合成测试仅新临时私有目录：执行全部178实际SQL，在真实history上重现旧134项枚举拒绝；修复清单通过；真实create/verify及错误history拒绝、不留下完成bundle；restore仍应被现有coverage拒绝。它不是旧CI污染数据复现。各轮实际退出码与原始摘要以PR评论记录为准，命令列出不代表已通过。打包skipTests只证明构建，不冒充测试。

## 恢复与卸载风险（尚未解决，不得隐去）

coverage.json只覆盖历史结构；本补丁不运行backup_coverage、不重录指纹、不替代gate。新备份可通过完整性verify，不代表恢复/激活兼容。旧schemaHash不匹配继续拒绝，不重签旧包或刷新有效期。当前history匹配仅version/script/success，不声明校验了数据库Flyway checksum。

preview-uninstall现有行为在create成功后删除源实例；若restore门禁仍拒绝，不能仅凭新create通过宣称安全卸载或可恢复。必须在独立架构审查明确该风险后决定是否需要额外阻止自动删除，不能绕过coverage让CI变绿。远程macOS仅新固定SHA一次，不重试旧run；记录真实checkout/Bash/locale有无及stop/uninstall/残留。主链成功不证明未执行分支、恢复可用或产品验收。


## 架构审查后补充：默认删除关闭

架构专家已对首版固定head bd51bd1459f0290b577e1d57042f2aef2c195207完整六文件差异实际复核，认定默认create后删除源有受支持恢复不可用风险，应阻断。本次在preview-uninstall.sh备份create成功后、任何删除之前，非dry-run默认非零退出，明确保留instance/secrets/logs/state及backup。没有调用--no-backup降级，也没有改原显式无备份选项的既有含义。该门禁有意保持关闭，直到源无关恢复/激活能力被独立审查建立；不会因以后coverage清单更新而自动开放。

新增真实shell控制流检验：仅在临时目录复制卸载脚本、替代common/stop及备份命令为合成夹具（不冒充真实DB备份），模拟create成功，断言默认--yes仍exit1、源/密钥/登记所在实例目录/日志/状态及合成bundle保留。原空目录单测保留，新增真正目录缺失负例。PG实跑restore现在要求明确coverage迁移拒绝消息及目标清理结果，不能用通用异常当恢复门禁证据。

首轮PG/打包在执行环境中断后没有进程、无完整exit文件及无jar，不能记为失败或通过；第二轮确认无所属进程后续接必要检查。PG合成夹具批量提交同一178文件、保持严格ON_ERROR_STOP；设置整体180秒异常超时并正常finally停止自有临时PG。Maven第二轮timeout180，skipTests；退出码124只记超时，不记通过。原备份19项成功不重复全跑。最新真实退出码在PR评论单独归档。

当前远程macOS预期是：前置主链与create可成功，但默认uninstall因恢复不可用非零并保留源，残留检查仅证明进程清理。不能把这种保护性拒绝报告为卸载成功；不改workflow将exit1改绿。

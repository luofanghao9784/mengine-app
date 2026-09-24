# M4-A1 Linux 隔离执行与回收边界

日期：2026-09-23。第六实施切片，沿用 AI-01—AI-04、AI-12—AI-13、POS-05。实现决定 DEC-061。本批将同一任务执行端口接到真实 Linux rootless Docker，验证资源限制与引擎异常退出后的回收；属于验证后端，不是云端生产恶意代码隔离验收。

## 平台与引擎的分工

Spring Boot 继续持有租户、空间、私人会话、任务与每步授权；独立引擎只接收本次允许的字节副本。新增 `DockerSandbox` 实现既有 `PackageSandbox`，与 macOS 后端互换，不改变 React 页面或公共业务接口。候选报告按实际后端标记 `linux-rootless-oci-prototype`，不再写死为 macOS。

引擎升级至 0.6.0；Agent 协议 1.2、来源/能力协议 1.0、公共会话 API 1.2.0、数据库 V9 保持不变。候选下载和许可/摘要准入仍在受限下载适配器中；任务容器不持有下载凭据、模型 Key、平台令牌或 Docker socket。候选包不加载到引擎主进程。

本批通过测试构造器注入 Linux 后端，`npm run test:agent` 可选择它进行整链路验证。正式入口仍拒绝 live 模式代码工具和候选执行，普通试用环境默认无模型；新增环境变量不会自行开启正式服务的代码执行。

## 一次执行如何隔离

1. 运维提供本地 Unix socket、固定镜像 ID（必须为 sha256）及独立部署 scope。模型不能指定镜像、挂载、网络、执行用户或资源参数。启动前检查 Linux、rootless、cgroup v2、systemd 和 seccomp；不满足则拒绝，不退回宿主执行。
2. 引擎校验输入数量、路径和总字节，生成只含普通文件/目录的 USTAR。最多 10 个授权文件、合计 1 MiB，候选包最多 64 个文件/512 KiB，脚本最多 16 KiB。
3. 字节经 Docker API 写入本任务独占的 Docker 数据卷，使用一个**从不启动**的暂存容器。执行容器将同一卷只读挂载到 `/job`，删除暂存容器后才启动任务。这样可兼容 Docker 禁止向只读根文件系统提取归档的规则，同时避免宿主路径绑定和执行时可写输入。
4. 执行用户 65532，根文件系统只读，丢弃全部 capabilities，启用 no-new-privileges 和默认 seccomp，网络设为 none，不挂载任何宿主目录或控制 socket，不继承环境变量和代理。执行目录只有任务输入/模块、临时盘和产物区。
5. 镜像内可信监督程序先读取实际 cgroup 与进程状态，核对内存、swap、CPU、PID、seccomp、capabilities、no-new-privileges 和 tmpfs 容量，确认限制有效后启动独立 Node 子进程。Node 权限模式只允许读 `/job`、写产物和 `/tmp`，禁止子进程/worker/原生扩展；这是额外限制，不能单独作为不可信代码隔离承诺。
6. 子进程退出后，监督程序只收集普通文件，拒绝目录、链接、多重硬链接、非法名称和超量输出。父进程校验规范 base64、字节数量及 SHA-256；清理失败不返回成功产物。服务原始错误、脚本 stderr 不作为诊断内容外泄。

| 资源 | 当前验证值 |
| --- | --- |
| 总内存 / swap | 192 MiB / 0；另设 Node 堆 64 MiB |
| CPU / PID | 0.5 核配额 / 32 |
| `/tmp` / 产物 tmpfs | 8 MiB / 4 MiB，noexec、nosuid、nodev |
| 共享内存 / Docker 日志 | 64 KiB / 单文件 256 KiB |
| 执行时限 | 默认 10 秒，可由运维设 100—15000 毫秒；沿用上层任务总时限 |
| 返回内容 | stdout/stderr 合计最多 64 KiB；最多 8 个产物、合计 64 KiB |
| 并发 | 每个适配器实例最多 2 个；第三个明确拒绝 |
| 资源到期 | 从分配起 60 秒；不是可运行 60 秒的授权 |

输入卷的容量由上传字节上限控制；没有提供整个宿主磁盘/镜像缓存的全局硬配额。每实例并发限制也不是租户额度或跨实例全局调度。CPU/PID 的有效配置已核对，没有进行 fork bomb 或吞吐压测。

## 取消、崩溃与回收

正常完成、脚本失败和取消都会强制删除本任务执行/暂存容器，再删除所属数据卷。清理使用独立短时限，不继承已取消的任务信号；删除失败记录为执行器清理错误，不交付成功半成品。

引擎进程被 SIGKILL 后，容器内监督程序仍按自身计时终止任务。所有分配资源带固定部署 scope、managed 标记和绝对到期时间。独立 `engine/scripts/reap-executions.mjs --watch` 每 5 秒回收本 scope 的过期容器/数据卷；每次新任务也检查到期资源。没有使用全局 prune，不清理其他 scope、未标记或尚未到期的资源。

部署时回收程序必须由独立服务/进程管理，不能随引擎一起退出。若回收程序和引擎同时关闭，任务代码仍有容器内时限，但输入卷须等回收服务或引擎恢复后才能删除；不承诺宿主离线期间数据即时消失。到期回收存在轮询和 Docker 响应延迟，不能把 60 秒写成绝对清除 SLA。宿主整体崩溃/重启恢复、跨节点回收仍需部署级验收。

## Linux 复验方法

需要专用于验证的 rootless Docker（cgroup v2＋systemd）及 Node 24.20.0；不可指向生产共用 Docker daemon。下列构建只上传 `engine/executor/`，不发送工作区、凭据或业务资料。准备根目录/引擎依赖及 README 所列 JDK、PostgreSQL、解析器；本批未提供一键云部署。

```bash
npm --prefix engine ci --ignore-scripts
npm --prefix engine run build
docker build -t dreamcore-executor:m4-a1 engine/executor
export DREAMCORE_EXECUTOR_IMAGE="$(docker image inspect dreamcore-executor:m4-a1 --format '{{.Id}}')"
export DREAMCORE_EXECUTOR_SOCKET="${XDG_RUNTIME_DIR}/docker.sock"
export DREAMCORE_EXECUTOR_SCOPE=dc-local-verification
npm --prefix engine run test:executor
```

`test:executor` 使用随机 scope，只清理自己的合成测试资源，包含真实到期等待，通常需约一分钟。测试不访问云模型。接着可用同一组环境变量在根目录运行 `npm run test:agent`；需先完成平台/前端构建与解析器安装。该链路模型、搜索和包传输为合成夹具，Harness、Linux 执行、PostgreSQL、网页和下载为真实运行。

独立终端/服务运行回收程序，使用与其服务的执行器完全相同的 scope：

```bash
node engine/scripts/reap-executions.mjs --watch
# 单次维护模式：
node engine/scripts/reap-executions.mjs --once
```

上述命令不是把回收程序装进引擎的子进程；正式部署需要运维为其配置独立自启动/重启策略及告警。rootless Docker socket 仍属于高权限控制接口，只交给可信调度层，不能暴露给任务或员工前端。未来云执行节点应与业务主机分离。

## 替换与剩余工作

同协议内可替换执行后端或更新镜像：排空/取消在途任务，验证固定镜像与限制，再替换引擎配置；回退保持原协议和历史私人产物，重启回收服务处理同 scope 的遗留资源。没有实际生产升级或回退演练。

普通 OCI 容器共享 Linux 内核，rootless 和资源限制不等同于多租户恶意代码安全认证。本批 macOS 上建立的 Linux 虚拟机是测试宿主，不是每任务独立虚拟机。云厂商/预算、执行节点、gVisor/微虚机评估、宿主配额与监控、真实模型费用和资料范围均尚未确认/验收，生产执行继续关闭。

下一切片优先补平台到任务的**指定文件版本原件最小授权**与撤权/取消链路，再扩展工具配方；真实模型、实际搜索服务与 WeKnora 分别按配置接入。画报和正式成果编辑/共享仍按 M5/M6 推进，不因本次验证宣布整个 M4 完成。

核对的官方依据：[rootless 限制与 cgroup](https://docs.docker.com/engine/security/rootless/tips/)、[资源约束](https://docs.docker.com/engine/containers/resource_constraints/)、[tmpfs](https://docs.docker.com/engine/storage/tmpfs/)、[Engine API v1.47](https://docs.docker.com/reference/api/engine/version/v1.47/)、[Moby 归档实现](https://github.com/moby/moby/blob/master/daemon/archive_unix.go)、[Lima 安装](https://lima-vm.io/docs/installation/)。实际版本和结果见[验证记录](../交接/M4-A1-Linux隔离执行与回收验证-2026-09-23.md)。

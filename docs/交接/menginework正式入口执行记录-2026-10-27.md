# menginework.com 正式入口执行记录

执行日期：2026-10-27。跟踪 Issue #176，依据上线交接 PR #162 及用户在本会话明确授权执行。本文记录实际完成项，不作为最终客户验收通过声明。

## 版本与范围

生产 ECS：`i-bp1fum8lr6472nuvzzac`，杭州，公网 `121.40.44.117`。业务应用保留 `/opt/mengine/releases/7514ebbdd8c393c5b313c5347f333f53035e6e18`，数据库迁移版本保持 168；没有发布当前 main 应用、升级 DH 或改变采集计划。

官网静态文件单独发布到 `/opt/mengine/website/08d3fa57575448612c0faeae46852fce03904177`；对应源码提交 `08d3fa57`。压缩包 SHA256：`81c1b3fbf5486ab7dc2013c9a9fc3661aac83e10ab49f61b504fe4c4a713eb42`。页脚展示黔ICP备2026020129号-1并链接工信部，登录按钮指向 `/workspace/`。演示新增接口均使用合成应答，不访问生产 API。

## 备份与恢复核验

服务器备份目录：`/data/mengine/backups/domain-entry-20261027T052629Z`，仅 root 可读。包含 `database.dump`、`objects.tar.gz`、`configuration.tar.gz`、`manifest.json` 及入口修改前的 Nginx、API 配置。

数据库备份已恢复到独立临时数据库后清理，确认迁移版本 168，2 个企业、9 个账号、145 个资料版本、174 个数据集和 714 个快照。对象文件恢复到独立临时目录，148 个文件逐一 SHA256 一致，再清理临时目录。未覆盖生产数据。

## DNS、证书与代理

根域 `@` A 记录指向 `121.40.44.117`，TTL 600，记录 ID `2114952534472694784`。两台权威 DNS `dns13.hichina.com`、`dns14.hichina.com` 及公共 DNS `223.5.5.5`、`1.1.1.1` 均返回正确 IP。未添加 www 或 AAAA，也未重复修改安全组。

Let's Encrypt 可信证书覆盖 `menginework.com`，到期 `2027-01-25 04:37:47 UTC`。证书位于 `/etc/letsencrypt/live/menginework.com/`。`certbot.timer` 已启用；部署钩子 `/etc/letsencrypt/renewal-hooks/deploy/mengine-nginx` 先校验 `/etc/nginx/mengine.conf`，再重载专用 Nginx 实例。已通过 `certbot renew --cert-name menginework.com --dry-run --run-deploy-hooks --no-random-sleep-on-renew` 演练，部署钩子成功校验并重载专用 Nginx。首次演练因默认 417 秒随机等待超时，关闭本次演练随机等待后成功；正式计时器保留默认调度。

专用网页服务仍使用 `/etc/nginx/mengine.conf`，新增公共入口 `/etc/nginx/mengine-public.conf`。80 仅提供 ACME 挑战与固定域名 HTTPS 跳转；443 代理到原回环端口 18480，API、引擎和数据库保持回环监听。两层代理转发 HTTPS；API 保留原 profile 和全部已有配置，仅补充 `server.forward-headers-strategy=framework`、`server.servlet.session.cookie.secure=true`，原版本 API 已重启并恢复健康。

公网入口覆盖转发地址，清除非可信 Forwarded 等头；关闭流式代理缓冲。官网演示限定 iframe，CSP 禁止联网和表单提交；直接访问演示、隐藏文件、内部接口和健康端点返回 404。

## 已完成验证与剩余验收

- 官网构建、11 项认证测试通过；Chromium 冒烟覆盖 8 张演示卡片、4 个嵌入界面、1440/390 宽度、存储保留，真实 API 请求、外部请求和未模拟接口均为 0。
- 从 ECS 按正式域名访问，证书链校验通过；首页及三个产品入口均 200，HTTP 正确跳转 HTTPS。首页引用的 7 个静态资源（含 favicon）逐一访问通过；演示 iframe 正常响应并配置禁止联网 CSP。
- 普通会话和平台 Cookie 均有 Secure、HttpOnly、SameSite；无 CSRF 的登录请求 403，匿名用户信息/企业管理/总台接口 401。
- 同版本 API 重启及专用网页服务重启均恢复正常；API、引擎、网页服务及证书计时器 active、enabled；迁移版本与全部采集计划配置和备份基线一致。
- 用户已确认：手机关闭 Wi-Fi 使用移动网络、另一台电脑访问，首页、证书和登录入口均正常。
- 剩余：正式账号登录、刷新、退出，普通成员访问总台、跨企业权限、上传下载、真实 AI 流式会话，需要正式测试身份。未完成前不宣布全量验收通过。

独立复核未发现上线阻塞；复核提出的官网图标静态映射缺项已补齐，验证脚本无效断言已移除。

本机自动化浏览器和直连请求受本机网络环境影响超时，未作为公网成功证据；外部设备通过项依据用户实际确认。

本地私有操作脚本与回执在项目 `.local/domain-launch-20261027/`，不入 Git；Workbench 使用 AliyunCLI OAuth 配置 `mengine-launch`，凭据不写入仓库。

## 回退

先备份当前入口状态并核对新业务写入。若仅入口异常，恢复备份里的 `mengine.conf.before`、`api.env.before-domain-entry`，移除新增 public include 配置，经 `nginx -t -c /etc/nginx/mengine.conf` 后重载原专用网页服务，确需恢复 API 配置时重启同版本 API。原 main 配置没有 public include，可单独先恢复入口，无需数据库回退。

DNS 回退只删除本次新增记录 ID，删除前确认当前值仍属于本次变更。证书和单独官网目录可保留用于排查。不得恢复旧数据库覆盖上线后的新数据；数据库恢复必须另定数据保护和恢复方案。

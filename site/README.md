# 官网（site/）

Mengine 梦核引擎与梦擎工作空间的官网首页，加三个端的登录页。Vite + React，独立的 `package.json`，不影响仓库根目录的构建。

## 运行

需要先在仓库根目录装好依赖（官网会直接编译根目录的客户端源码），再装官网自己的：

```bash
npm ci            # 仓库根目录
npm ci --prefix site
npm run dev --prefix site      # http://127.0.0.1:5180/
npm run build --prefix site    # 产物在 site/dist/；包含 demo、Login 及主仓库引用的类型检查
npm run test:auth --prefix site
npm run preview --prefix site -- --port 5186 --strictPort
# 另一个终端：
npm run test:smoke --prefix site
```

## 页面

| 地址 | 内容 |
| --- | --- |
| `index.html` | 官网首页 |
| `login/index.html`、`login/admin.html`、`login/platform.html` | 员工、企业管理端、运营平台的登录页。同一个页面按地址切换，三端之间页内切换并带背景过渡 |
| `demo/index.html` | 用合成数据驱动的真实客户端，只给首页用 iframe 嵌入展示，不是对外入口 |

## 结构

- `src/App.tsx`、`src/site.css`：首页。前半段是固定在屏幕上的 3D 引擎（`src/EngineViews.tsx`），滚动时镜头在各章视角之间连续移动；一次日出过渡之后是梦擎工作空间的各段。
- `src/engine/`：引擎 3D 场景的副本与官网专用的少量追加，见该目录的 README。
- `src/demo/`：`mock-api.ts` 在浏览器里替客户端应答所有 `/api/**` 请求，内容取自 `scripts/design/preview-workspace.ts`，全部是示例数据；`boot.ts` 装好它之后启动 `src/identity/main.tsx`。
- `src/login/`：登录页。标志、输入框、按钮、主题都直接引用根目录的产品组件。

## 接入与部署边界

- `src/login/auth.ts` 四个函数已接入现有 API，复用 CSRF、响应校验与错误处理。员工/企业管理员共用客户账号，分别进入 `/workspace/`、`/tenant-admin/`；平台独立账号及 Cookie 进入 `/platform-admin/`。邀请校验后交给原加入企业流程，跳转不带邀请码。用户确认本轮不新增旧邮箱迁移或绑定手机号页面。
- 公司全称：贵州岚云智能科技有限公司；电话：18586861020。2026-10-27 用户确认备案已通过，并授权正式域名入口上线；页脚展示黔ICP备2026020129号-1及工信部链接，登录指向同域 /workspace/。官网静态发布与原业务应用、DH 版本分开，不以官网入口更新升级业务应用。首页结构、视觉、章节与产品描述保持已确认版本；技能中心八个技能仍是示例，不据此开发新业务。
- 后端目前没有真实短信供应商，仅支持禁用或本地测试投递。禁用时显示既有错误；本地验证码不伪称短信已发送，页面不读取或展示测试验证码。对外内部测试入口关闭本地短信投递和预览。
- 三端登录的真实 API 联调和 1440/390 宽度检查见[整合记录](../docs/交接/官网登录接入与内部部署-2026-10-10.md)，不代表最终业务迁移或用户验收。

## 同域部署与演示隔离

- 官网构建须带整个仓库；产物 `site/dist/` 位于官网根目录。新增 `website-assets/` 与产品 `/assets/` 分开，三个登录页、API 和产品三端保持同源，不扩大 Cookie Domain 或启用跨域凭据。
- `/demo/` 仅供首页 iframe，部署配置拒绝顶层导航并以 CSP 禁止演示网络连接。浏览器合成接口仍拦截全部 `/api/**`。
- 演示启动前使用内存存储和通知替身，不清理真实工作空间草稿/偏好或发送真实会话通知。`test:smoke` 验证父页面草稿保留、缺失 mock 为零、没有真实 API 或外部请求。
- 修改根客户端接口后执行官网 build 和 smoke；新增的 `tsconfig.integration.json` 包含原先排除的 demo/Login。`test:types` 可单独运行。
- `src/engine/` 副本本轮不重构，按其 README 单独安排。

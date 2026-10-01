# 本地解析执行器（M3-A1）

这是受限的文档转换进程，通过 `DocumentParser` 接口接入平台；不运行用户脚本、宏或 Agent Skill，不调用云模型。网页和未来 App 共用平台 Knowledge API，不直接依赖此实现。

当前执行环境验证：macOS Apple Silicon、Python 3.14.6、Poppler 26.03.0、Tesseract 5.5.2。Python 依赖固定于 `requirements.txt`；测试生成 XLS 使用 `requirements-test.txt`。macOS 沙箱以外的平台没有无隔离回退，Linux 容器执行器另行实现和验收。

在仓库根目录执行：

```bash
npm run setup:parser -- --with-tests
npm run test:parser
```

需要已有 `/opt/homebrew/bin/{pdfinfo,pdftotext,pdftoppm,tesseract}` 及 `/usr/bin/sandbox-exec`。安装脚本只从 PyPI 下载固定版本 wheel、从 Tesseract 官方仓库下载校验 SHA-256 的 OCR 文件；不安装系统软件、不产生模型调用费用。运行阶段禁止联网。

OCR 数据锁定 `tessdata_fast` 4.1.0 对应提交 `65727574dfcd264acbb0c3e07860e4e9e9b22185`，下载的 `chi_sim`/`eng` 文件在忽略的 `.local/tessdata`。当前以 `chi_sim` 进行中文优先识别，也可提取英文和数字；识别结果一律标记需核对，不能当作财务计算依据。合成中文样例中“梦”仍可能识别成“药”。

`sandbox.py` 是可信启动器：清空继承环境，白名单只读系统运行库、Homebrew 安装目录、执行器目录和本任务目录；仅本任务目录可写，禁止联网和读取其他任务正文。`parse.py` 不解析执行 HTML。默认单文件 20 MiB，30 页 PDF，40 MB OpenXML 总展开量、3000 ZIP 条目，2000 字符/片段，最多 500 片段/40 万字符；图片最多 2000 万像素。CPU、文件大小、句柄数及 75 秒墙钟限额，Java 外层 85 秒兜底并清理任务目录。macOS 不可靠地执行地址空间内存限制，输入膨胀限制不能代替部署时的 cgroup/容器内存限额。

结果协议：`parserVersion/status/warnings/chunks`；片段只有 `locator/content/method`。当前实现为 `local-3`，平台适配器兼容 `local-1`、`local-2` 和 `local-3`；历史片段不自动改写。API 校验返回大小、枚举与字段，再复核授权后持久化。警告码允许大写字母、数字和下划线（须字母开头、最多 64 字符），包含 `ENCODING_GB18030`。错误仅返回通用代码，工具 stderr 不进入业务日志。取消/失败不冒充理解成功。

| 格式 | 当前结果 | 已知边界 |
| --- | --- | --- |
| TXT / Markdown | 按行文字，UTF-8/BOM、UTF-16、GB18030 | 不执行 HTML；编码回退有提示 |
| CSV | 记录序号与原始单元格字符串 | 全空记录跳过；不推测数字格式、不执行公式；多行单元格保留 |
| DOCX | 正文段落、表格行 | 图片、页眉页脚等有部分提取提示；非原排版预览 |
| XLSX | 工作表、行、单元格地址、值与公式缓存 | 不依赖声明范围截取；实际坐标限 20,000 行/200 列；不重算公式、不执行宏/外链；缓存缺失明确提示 |
| XLS | 工作表行与保存的值 | 仅缓存值；不验证公式 |
| PDF | 页级文本，空文本页转图 OCR | 前 30 页；图表、复杂布局和混合页面图片未完整解读，始终提示 |
| PNG / JPG / JPEG | 图片 OCR 文字；任务副本应用 EXIF 方向 | 不是视觉理解；识别可能有误，原件保持不变 |
| DOC / PPT / 音视频及其他 | `UNSUPPORTED` | 原件保留可下载；资料库尚未自动选择工具转换，现有 Agent 可信配方不等于通用格式支持 |

M7-A1 第四切片提供 `npm run test:formats`，用 21 份可重建合成样例验证真实上传、解析、检索、固定引用、失败提示及字节一致下载；先完成前端构建、API 打包和 Chromium 安装。完整范围与已知限制见[默认格式样例边界](../../docs/技术/M7-A1默认格式样例与解析边界.md)。

依赖许可资料随已安装包的 `.dist-info` 保留；Tesseract/OCR 数据为 Apache-2.0，Poppler 以系统独立可执行程序调用，受其 GPL 许可约束；当前不打包分发这些系统二进制。后续交付镜像或私有部署包时需附对应许可证/notice，并按实际分发内容完成审查。WeKnora 尚未安装，见[接入记录](../../docs/技术/M3-A1本地解析与WeKnora接入边界.md)。

`local-3` 将 XLSX 连续非空行组合为至多 2000 字符的片段，保留工作表、原单元格坐标、标题及列名。空行分隔不同表块，长表分页时重复至多两行、600 字符的原始前文；前文不被推断为表头。原值、公式缓存及解析警告保留。历史解析不自动更新，用户重新解析同一原件版本后才用于新任务，旧引用仍指向旧解析。

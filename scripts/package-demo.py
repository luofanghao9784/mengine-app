"""Build and zip a portable frontend demo using an explicit file allowlist."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"], cwd=root, check=True)

files = {}
for folder in ("src", "public", "tests", "dist", "contracts"):
    for path in sorted((root / folder).rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"Refusing to package symlink: {path.relative_to(root)}")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts):
            files[path.relative_to(root).as_posix()] = path.read_bytes()

for name in (
    "package.json", "package-lock.json", "index.html", "tsconfig.json",
    "workspace/index.html", "tenant-admin/index.html", "platform-admin/index.html",
    "vite.config.ts", "playwright.config.ts", ".editorconfig", ".prettierrc.json",
    ".gitignore", "scripts/serve-demo.mjs",
):
    files[name] = (root / name).read_bytes()

files["README.md"] = (root / "docs/交接/Demo转发与启动.md").read_bytes()
files["AGENTS.md"] = """# 前端 Demo 转发包

这是从完整开发项目导出的独立预览包，启动依据为 README.md。
默认任务是启动既有 dist 页面供本机体验，使用 node scripts/serve-demo.mjs；无需安装 npm 依赖。
保留演示功能与浏览器本地数据，不擅自升级依赖、接入后端、真实 AI 或发布服务。
需要修改源码时按 README.md 运行，遵循用户当次授权。执行结果必须以实际服务和页面检查为准。
本包未包含原项目的完整需求、内部资料和开发交接文档；继续产品开发时需从完整项目补齐。
""".encode("utf-8")
files["验证记录.txt"] = f"""打包时间：{datetime.now().astimezone().isoformat(timespec='seconds')}
已执行：npm run build（包含 TypeScript 检查与 Vite 构建）。
构建包含空谷合成经营数据、公开资讯摘要及原站图片链接，不包含发送方浏览器 localStorage，也未打包下载的第三方新闻图片。原站配图需要联网。
本脚本只记录实际执行的构建，不自动声称通过浏览器或跨平台验收。
本机 Node.js：{subprocess.check_output(['node', '--version'], text=True).strip()}
其他检查若已执行，记录在随包补充的交付验证记录中。
""".encode("utf-8")
files["文件校验清单.json"] = json.dumps(
    {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
    ensure_ascii=False, indent=2,
).encode("utf-8")

output_dir = root / "交付包"
output_dir.mkdir(exist_ok=True)
output = output_dir / f"enterprise-ai-workspace-demo-{datetime.now():%Y%m%d-%H%M%S}.zip"
with tempfile.NamedTemporaryFile(dir=output_dir, suffix=".tmp", delete=False) as temp:
    temp_path = Path(temp.name)
try:
    with ZipFile(temp_path, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(files.items()):
            archive.writestr(f"enterprise-ai-workspace-demo/{name}", content)
    temp_path.replace(output)
finally:
    temp_path.unlink(missing_ok=True)

print(f"演示包：{output}")
print(f"文件数：{len(files)}；大小：{output.stat().st_size / 1024 / 1024:.2f} MB")

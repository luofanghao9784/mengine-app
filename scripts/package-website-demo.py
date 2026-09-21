"""Package the website with a fresh frontend build without changing either dist."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent.parent
source = root / "website/dist"
if not (source / "index.html").is_file():
    raise SystemExit(
        "缺少独立官网仓库 website/dist/index.html。主项目克隆默认不含官网；"
        "请按 COLLABORATION.md 获取官网仓库，或仅运行 scripts/package-demo.py 打包工作台。"
    )
npm = "npm.cmd" if os.name == "nt" else "npm"
subprocess.run([npm, "exec", "--", "tsc", "--noEmit"], cwd=root, check=True)

with tempfile.TemporaryDirectory(prefix="ai-dreamcore-package-") as temporary:
    stage = Path(temporary)
    dist = stage / "dist"
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source)
        if rel.parts[:2] == ("demo", "app") or any(part.startswith(".") for part in rel.parts):
            continue
        if path.is_symlink():
            raise RuntimeError(f"Refusing symlink: {rel}")
        if path.is_file():
            destination = dist / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)

    subprocess.run([
        npm, "exec", "--", "vite", "build", "--base", "./",
        "--outDir", str(dist / "demo/app"), "--emptyOutDir",
    ], cwd=root, check=True)
    # Existing data references /images/... from the site origin.
    shutil.copytree(root / "public/images", dist / "images", dirs_exist_ok=True)
    entry = dist / "demo/app/index.html"
    entry.write_text(entry.read_text().replace('href="/favicon.svg"', 'href="./favicon.svg"'))
    wrapper = dist / "demo/index.html"
    html = wrapper.read_text()
    old_route = "client:'chat/client'"
    if old_route not in html:
        raise RuntimeError("Demo wrapper changed; verify the conversation entry before packaging.")
    wrapper.write_text(html.replace(old_route, "client:'chat/kg-event-plan'"))

    files = {}
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"Refusing symlink: {path.relative_to(stage)}")
        if path.is_file():
            if any(part.startswith(".") for part in path.relative_to(stage).parts):
                raise RuntimeError(f"Unexpected hidden output: {path.relative_to(stage)}")
            files[path.relative_to(stage).as_posix()] = path.read_bytes()
    files["README.md"] = (root / "docs/交接/官网与Demo转发与启动.md").read_bytes()
    files["scripts/serve-website-demo.mjs"] = (root / "scripts/serve-website-demo.mjs").read_bytes()
    files["package.json"] = json.dumps({
        "name": "ai-dreamcore-preview", "private": True, "version": "0.1.0",
        "type": "module", "engines": {"node": ">=22.12.0"},
        "scripts": {"start": "node scripts/serve-website-demo.mjs"},
    }, ensure_ascii=False, indent=2).encode()
    files["Start-macOS.command"] = b'''#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12+ is required. Install Node.js, then try again."
  read -r answer
  exit 1
fi
node scripts/serve-website-demo.mjs
if [ "$?" -ne 0 ]; then
  echo "See the error above. Press Enter to close."
  read -r answer
fi
'''
    files["Start-Windows.cmd"] = b'''@echo off\r
cd /d "%~dp0"\r
where node >nul 2>&1\r
if errorlevel 1 (\r
  echo Node.js 22.12+ is required. Install Node.js, then try again.\r
  pause\r
  exit /b 1\r
)\r
node scripts/serve-website-demo.mjs\r
if errorlevel 1 pause\r
'''
    files["AGENTS.md"] = """# 官网与 Demo 体验包
启动依据为 README.md。默认使用 node scripts/serve-website-demo.mjs 预览现有 dist，无需安装依赖。
本包不包含 React 开发源码。只启动演示时不修改网页、数据或依赖，不接入后端、真实 AI 或发布服务。
用户要求体验时保持服务运行，并检查实际地址及静态资源。内部文件和浏览器数据不对外共享。
""".encode()
    files["验证记录.txt"] = f"""制作时间：{datetime.now().astimezone().isoformat(timespec='seconds')}
已执行：TypeScript 检查（tsc --noEmit）、Vite 构建（base ./），构建失败不会生成包。
官网取自 website/dist；工作台取自当前 src 的新构建，未覆盖原有构建目录。
会话入口在包内映射到空谷读书会筹备示例 kg-event-plan。
Node.js：{subprocess.check_output(['node', '--version'], text=True).strip()}
不含发送方浏览器数据、内部文档、依赖目录、环境凭据与托管配置。
第三方新闻图片保留原站链接，需要联网；未下载再分发。
此脚本仅记录实际构建。浏览器、HTTP 或跨平台验证以单独的交付验证记录为准。
""".encode()
    files["文件校验清单.json"] = json.dumps({
        name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())
    }, ensure_ascii=False, indent=2).encode()

    output_dir = root / "交付包"
    output_dir.mkdir(exist_ok=True)
    output = output_dir / f"AI-Dreamcore-官网与前端Demo-{datetime.now():%Y%m%d-%H%M%S}.zip"
    with tempfile.NamedTemporaryFile(dir=output_dir, suffix=".tmp", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        with ZipFile(temp_path, "w", ZIP_DEFLATED, compresslevel=9) as archive:
            for name, content in sorted(files.items()):
                info = ZipInfo(f"ai-dreamcore-preview/{name}", datetime.now().timetuple()[:6])
                info.create_system = 3
                info.external_attr = (0o100755 if name.endswith(".command") else 0o100644) << 16
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, content, compresslevel=9)
        temp_path.replace(output)
    finally:
        temp_path.unlink(missing_ok=True)

print(f"官网与 Demo 包：{output}")
print(f"文件数：{len(files)}；大小：{output.stat().st_size / 1024 / 1024:.2f} MB")

# 文稿导出字体

Dreamcore Document Sans SC Regular 是 Noto Sans SC 2.004 的 400 字重静态实例，用于离线 PDF 排版和 PDF/DOCX 子集嵌入。派生名称已更改，原始版权、许可及作者元数据保留，仍按附带 OFL 1.1 分发，不作为独立字体商品。

- 原项目：[notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)，原作者 Adobe / Google（完整原始声明见字体 name 表及 OFL.txt）。
- 固定源码：523d033d6cb47f4a80c58a35753646f5c3608a78（Sans2.004），Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf。
- 源 SHA-256：d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964。
- 产物 SHA-256：d033bb0663f8afd4349c219e2634783f102b64f49871a367675c16718297e5fb。
- 仅开发时用 fonttools 4.61.1 和仓库 scripts/documents/build-font.py 重建；运行时随 JAR 加载，不访问外网或用户机器字体。

中文及拉丁文字按实际字形覆盖支持。缺失字形时 PDF 导出明确失败并可改用 Word；不以方框替换内容。DOCX 嵌入本文出现且字体覆盖的 BMP 字形子集，并随包保留 OFL.txt；其他 Unicode 文本保持原文，由客户端字体回退。新增编辑字符可能需要客户端字体；目标 Word/WPS 打开效果仍需实机验收。

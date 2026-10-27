# 来源规则契约一致性 1.0

共同样例 `conformance-v1.json` 在梦擎和独立采集器保持相同字节；两端独立执行，采集 READY 不代替接收核验。规则总数最多 100，枚举值最多 100；日期严格四位年 YYYY-MM-DD；金额使用 ASCII 十进制、可带符号和指数，不接受 NaN、Infinity 或全角数字。

只有结构/声明不完整返回 WAITING_SOURCE_DEFINITION；已支持规则下的值异常返回 SOURCE_DATA_REQUIRES_REVIEW。MODEL_DETERMINED 仍可使用，不新增依据或人工批准门槛。扩展规则必须同步更新共同样例及两端实现。

边界补充：TEXT 空白按 Unicode whitespace/space（含 NBSP、NEL）判定；DATE 年份为 0001–9999。DECIMAL 字符串最长 4096，scale 绝对值与 precision−scale 绝对值均不超过 4096，避免极端指数导致两端分歧或格式化内存膨胀。

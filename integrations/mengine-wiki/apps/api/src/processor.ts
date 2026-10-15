import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { Store } from "./store.js";
import { now, scan, canIngest, type Doc } from "./domain.js";
export class Processor {
  active = new Map<string, Promise<void>>();
  running = 0;
  waiters: (() => void)[] = [];
  async acquire() {
    if (this.running >= 2)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.running++;
  }
  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.running--;
  }
  constructor(
    private store: Store,
    public root: string,
  ) {}
  async save(d: Doc, bytes: Buffer) {
    await mkdir(this.root, { recursive: true });
    d.originalPath = join(this.root, `${d.id}.${d.kind}`);
    await writeFile(d.originalPath, bytes, { mode: 0o600 });
    this.store.saveDoc(d);
    this.enqueue(d);
  }
  enqueue(d: Doc) {
    if (this.active.has(d.id)) return;
    const work = (async () => {
      await this.acquire();
      try {
        await this.process(d);
      } finally {
        this.release();
      }
    })().finally(() => this.active.delete(d.id));
    this.active.set(d.id, work);
  }
  resume() {
    const rows = this.store.db.prepare("SELECT data FROM documents").all() as {
      data: string;
    }[];
    for (const r of rows) {
      const d = JSON.parse(r.data) as Doc;
      if (["queued", "processing"].includes(d.status)) {
        this.store.saveDoc(d, "resumed");
        this.enqueue(d);
      }
    }
  }
  async process(doc: Doc) {
    let d = this.store.doc(doc.tenantId, doc.id);
    if (!d || !["queued", "processing"].includes(d.status)) return;
    try {
      const actor=this.store.user(d.uploadedBy?.id || d.ownerId);
      if(!actor || actor.tenantId!==d.tenantId || !canIngest(actor))throw new Error("任务执行人已失去导入权限，解析停止");
      d.status = "processing";
      this.store.saveDoc(d, "parsing");
      const bytes = await readFile(d.originalPath);
      let text = "";
      if (["txt", "md"].includes(d.kind)) text = bytes.toString("utf8");
      else if (d.kind === "docx")
        text = (await mammoth.extractRawText({ buffer: bytes })).value;
      else if (d.kind === "pdf") {
        const parser = new PDFParse({ data: new Uint8Array(bytes) });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      }
      text = text.replace(/\u0000/g, "").trim();
      if (!text) throw new Error("未提取到正文，扫描 PDF 需要先进行 OCR");
      if (text.length > 2_000_000)
        throw new Error("提取正文超过 200 万字符，请拆分文件");
      const latest = this.store.doc(d.tenantId, d.id);
      if (!latest || latest.status === "archived") return;
      const currentActor=this.store.user(doc.uploadedBy?.id || doc.ownerId);
      if(!currentActor || currentActor.tenantId!==doc.tenantId || !canIngest(currentActor) || latest.version!==doc.version || latest.policyVersion!==doc.policyVersion)throw new Error("任务身份或来源版本已变化，拒绝发布解析结果");
      d = latest;
      d.content = text;
      d.summary = text.replace(/[#*`]/g, "").slice(0, 180);
      this.store.saveDoc(d, "scanning");
      const report = scan(text, d.tags, d.reviewAt);
      d.issues = report.issues;
      d.quality = report.quality;
      d.status = report.sensitive ? "quarantined" : "ready";
      if (report.sensitive) d.classification = Math.max(2, d.classification);
      d.error = null;
      d.updatedAt = now();
      this.store.db.transaction(() => {
        this.store.saveDoc(d!);
        this.store.version(d!);
        const user = this.store.user(d!.ownerId);
        if (user)
          this.store.audit(
            user,
            "document.processed",
            d!.title,
            `解析完成 · ${text.length} 字符 · ${d!.status}`,
          );
      })();
    } catch (e) {
      // A late parser error must not resurrect a task archived while file I/O was in flight.
      const latest = this.store.doc(doc.tenantId, doc.id);
      if (!latest || latest.status === "archived") return;
      d = latest;
      d.status = "failed";
      d.error = e instanceof Error ? e.message : "解析失败";
      d.updatedAt = now();
      this.store.saveDoc(d);
    }
  }
  async close() {
    await Promise.allSettled(this.active.values());
  }
}

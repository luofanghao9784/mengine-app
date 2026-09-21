import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Research preview only. Remote assets stay at their original source URLs.
const directory = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await fs.readFile(path.join(directory, '来源与图片.json'), 'utf8'));
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>空谷无界｜调研图源核验</title>
<style>body{font:15px system-ui;background:#f5f7fa;color:#243348;margin:30px}h1{font-size:28px}p{line-height:1.6}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:white;padding:16px;border:1px solid #e4e9ef;border-radius:12px}img{width:100%;height:210px;object-fit:contain;background:#f1f4f8}h2{font-size:17px;line-height:1.4;margin:10px 0}small{display:block;color:#667084;line-height:1.5}a{color:#245ebe}footer{margin-top:20px;color:#667084}</style>
<h1>空谷无界｜调研图源核验</h1><p>2026-09-20 · 真实报道的原图候选。历史事件、行业图片与空谷门店资料分别标注；此页不是已接入 Demo 的画报。</p><main>
${data.images.map((item) => `<article><img data-id="${item.id}" src="${escape(item.url)}" alt="${escape(item.caption)}"><h2>${item.id} · ${escape(item.caption)}</h2><small>${escape(item.credit)}</small><p><a href="${escape(data.sources.find((s)=>s.id===item.sourceId).url)}" target="_blank" rel="noreferrer">查看原文与日期</a></p><small>${escape(item.reuseStatus)}</small></article>`).join('')}
</main><footer>图片从原站加载，未下载原图或打入转发包。网络、原站调整和图片使用许可需在实际演示前复核。</footer></html>`;
await fs.writeFile(path.join(directory, '图源预览.html'), html);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 25000 }).catch(() => {});
  const checks = await page.locator('img').evaluateAll((imgs) => imgs.map((i) => ({id:i.dataset.id, loaded:i.complete && i.naturalWidth>0, width:i.naturalWidth, height:i.naturalHeight})));
  await page.screenshot({path:path.join(directory,'图源核验.png'),fullPage:true});
  await fs.writeFile(path.join(directory,'图源加载核验.json'),JSON.stringify({checkedAt:new Date().toISOString(),method:'Playwright Chromium，原站URL直接加载；未下载原图',images:checks},null,2)+'\n');
  console.log(JSON.stringify(checks,null,2));
} finally { await browser.close(); }

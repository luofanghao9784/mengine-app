/** Render Mermaid into verified, offline SVG and a searchable local atlas. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '../..');
const require = createRequire(path.join(sourceRoot, 'package.json'));
const { chromium } = require('playwright');
const library = path.join(sourceRoot, '.local/diagram-tools/mermaid-11.4.1.min.js');
try { await fs.access(library); } catch {
  throw new Error('Run python3 docs/项目流程图/prepare.py to prepare the pinned renderer.');
}
const catalog = JSON.parse(await fs.readFile(path.join(here, 'catalog.json'), 'utf8'));
const output = path.join(here, 'diagrams');
const installedChrome = process.env.DIAGRAM_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = await fs.access(installedChrome).then(() => true, () => false);
const browser = await chromium.launch({ headless: true, ...(hasChrome ? { executablePath: installedChrome } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1.5 });
const rendered = [];
try {
  await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ path: library });
  await page.evaluate(() => {
    window.mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base',
      themeVariables: { fontFamily: 'Arial, "PingFang SC", sans-serif', fontSize: '16px',
        primaryColor: '#edf4ff', primaryTextColor: '#18324c', primaryBorderColor: '#91abc4',
        lineColor: '#5d768a', secondaryColor: '#edf8f1', tertiaryColor: '#fff4dc',
        edgeLabelBackground: '#ffffff' },
      flowchart: { htmlLabels: false, curve: 'basis', useMaxWidth: false, nodeSpacing: 28,
        rankSpacing: 34, padding: 14 },
    });
  });
  for (const diagram of catalog.diagrams) {
    const result = await page.evaluate(async ({ id, mermaid }) => {
      await window.mermaid.parse(mermaid);
      return window.mermaid.render('diagram' + id, mermaid);
    }, diagram);
    if (!result.svg.includes('<svg') || result.svg.includes('Syntax error')) throw new Error(diagram.id);
    const svg = result.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
      .replace(/xmlns="http:\/\/www.w3.org\/2000\/svg"([^>]*?)xmlns="http:\/\/www.w3.org\/2000\/svg"/, 'xmlns="http://www.w3.org/2000/svg"$1');
    await fs.writeFile(path.join(output, diagram.id + '.svg'), svg);
    rendered.push({ ...diagram, svg });
  }
} finally {
  await browser.close();
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const groups = ['功能流程', '开源替代方案', '实现流程'];
const nav = groups.map(group => `<h2>${group}</h2>` + rendered.filter(d => d.group === group).map(d =>
  `<a href="#${d.id}" data-id="${d.id}" data-search="${esc(d.title + ' ' + d.description + ' ' + (d.options || []).map(o => o.name).join(' '))}"><span>${d.id}</span>${esc(d.title)}</a>`).join('')).join('');
const articles = rendered.map((d, i) => `<article id="panel-${d.id}" data-diagram="${d.id}" ${i ? 'hidden' : ''}>
  <div class="kicker">${d.group} / ${d.id}</div><h1>${esc(d.title)}</h1>
  <p class="description">${esc(d.description)}</p>
  ${(d.options || []).length ? `<div class="option-links"><b>局部复用研判：</b>${d.options.map(o => `<a href="开源替代研判.html#${o.id}" target="_blank">${esc(o.name)} · ${o.priority}</a>`).join('')}</div><div class="legend"><span class="priority">优先验证</span><span class="conditional">条件候选</span><span class="existing">已经使用</span><span>蓝色：保留业务；虚线：候选标注</span></div>` : ''}
  <div class="toolbar"><button data-action="smaller" aria-label="缩小流程图">−</button><span class="scale" aria-live="polite">100%</span><button data-action="larger" aria-label="放大流程图">＋</button><button data-action="fit">适应宽度</button><button data-action="whole">查看全图</button><a href="diagrams/${d.id}.svg" target="_blank">打开完整图</a><a href="diagrams/${d.id}.mmd" download>Mermaid 源码</a></div>
  <div class="diagram-scroll" tabindex="0" aria-label="${esc(d.title)}，可滚动查看完整流程"><div class="drawing">${d.svg}</div></div>
  ${(d.options || []).length ? `<details class="recommendations"><summary>本图可替代哪些部分 · ${d.options.length} 项研判</summary><div class="option-grid">${d.options.map(o => `<section><div class="tag">${esc(o.priority)} · ${esc(o.kind)}</div><h3><a href="开源替代研判.html#${o.id}" target="_blank">${esc(o.name)}</a></h3><p><b>替代：</b>${esc(o.replace)}</p><p><b>保留：</b>${esc(o.retain)}</p><p><b>许可：</b>${esc(o.license)}</p><p><a href="${o.url}" target="_blank" rel="noopener">官方项目</a> · <a href="开源替代研判.html#${o.id}" target="_blank">接法、代价与验证条件</a></p></section>`).join('')}</div></details>` : ''}
  <details class="evidence"><summary>实现依据 · ${d.sources.length} 处源码或文档</summary><ul>${d.sources.map(s => `<li>${s.kind === 'web' ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.label)} · 官方依据</a>` : `<b>${esc(s.label)}</b><code>${esc(s.path)}</code>`}</li>`).join('')}</ul><p>源码依据可在 Markdown 中打开；官方依据打开对应项目页面。外部能力与接入建议不等于当前已实现。</p></details>
</article>`).join('');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mengine 三端功能与实现流程</title>
<style>
:root{color-scheme:light;--ink:#152d40;--muted:#536778;--line:#dce5ec;--blue:#1e5e91;--paper:#fff;--bg:#f5f8fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}a{color:var(--blue)}button,input{font:inherit}button{cursor:pointer}header{padding:20px 28px;background:#122e43;color:#f8fcff;display:flex;justify-content:space-between;gap:20px;align-items:center}header strong{font-size:22px;letter-spacing:.02em}header p{margin:3px 0 0;color:#cfdae2;font-size:13px}header a{color:#d4eaff;margin-left:16px;text-decoration:none}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);max-width:1800px;margin:auto}aside{padding:22px 15px;border-right:1px solid var(--line);height:calc(100vh - 97px);position:sticky;top:0;overflow:auto}aside input{width:100%;border:1px solid #bacbd9;border-radius:6px;background:white;padding:9px 12px}nav h2{font-size:12px;color:var(--muted);letter-spacing:.08em;margin:24px 12px 8px}nav a{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border-radius:7px;text-decoration:none;color:var(--ink);font-size:13px;line-height:1.5}nav a span{font:12px/1.8 ui-monospace,monospace;color:var(--muted)}nav a[aria-current="page"]{background:#dfeef8;color:#123c5b}nav a:hover{background:#e7f0f6}main{padding:30px 34px;min-width:0}.boundary{font-size:12px;color:var(--muted);margin:0 0 24px;padding-bottom:16px;border-bottom:1px solid var(--line)}.kicker{font-size:12px;letter-spacing:.08em;color:var(--blue)}h1{font-size:27px;line-height:1.4;margin:7px 0 12px;font-weight:600}.description{max-width:980px;margin:0 0 20px;color:#415868}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-bottom:14px}.toolbar button,.toolbar a{border:1px solid #c6d5e0;background:#fff;color:var(--ink);border-radius:5px;padding:5px 11px;text-decoration:none;font-size:13px}.toolbar button:hover{background:#eaf2f8}.scale{font-variant-numeric:tabular-nums;font-size:12px;min-width:44px;text-align:center;color:var(--muted)}.diagram-scroll{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:76vh;padding:26px}.drawing{width:max-content;min-width:100%;display:flex;justify-content:center}.drawing svg{flex:none;height:auto;max-width:none!important;display:block}.evidence{margin:22px 0;color:var(--muted);font-size:13px}.evidence summary{cursor:pointer;color:var(--ink)}.evidence ul{padding:0;list-style:none}.evidence li{margin:10px 0}.evidence b{font-weight:500;display:block}.evidence code{font-size:12px;overflow-wrap:anywhere}.footer{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:20px;margin-top:24px}.footer button{border:0;background:transparent;color:var(--blue);padding:8px 0}.footer span{color:var(--muted);font-size:12px}button:focus-visible,a:focus-visible,input:focus-visible,.diagram-scroll:focus-visible{outline:3px solid #7ab7df;outline-offset:2px}[hidden]{display:none!important}@media(max-width:850px){header{align-items:flex-start;padding:18px;flex-direction:column;gap:8px}header a{margin-left:0;margin-right:14px}.layout{display:block}aside{height:auto;max-height:280px;position:static;border-bottom:1px solid var(--line);border-right:0}nav{display:grid;grid-template-columns:1fr 1fr}nav h2{grid-column:1/-1}main{padding:22px 16px}h1{font-size:23px}.diagram-scroll{padding:16px}}@media print{header,aside,.toolbar,.footer,.boundary{display:none}.layout{display:block}main{padding:0}article[hidden]{display:block!important}article{break-before:page}.diagram-scroll{max-height:none;overflow:visible;border:0;padding:0}.drawing{width:100%}.drawing svg{max-width:100%!important}.evidence{display:none}}
.option-links{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0;font-size:12px;align-items:center}.option-links a{padding:3px 8px;background:#e9f3ee;border:1px solid #c5dcd0;border-radius:5px;text-decoration:none}.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#546779;margin:0 0 17px}.legend .priority,.legend .conditional,.legend .existing{padding-left:12px;position:relative}.legend .priority:before,.legend .conditional:before,.legend .existing:before{content:"";width:8px;height:8px;position:absolute;left:0;top:5px;border-radius:2px}.priority:before{background:#2e8052}.conditional:before{background:#ac7b27}.existing:before{background:#8063ad}.recommendations{margin:22px 0;font-size:13px}.recommendations summary{cursor:pointer;color:#175335;font-weight:600}.option-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.option-grid section{background:white;border:1px solid #d5e4da;border-radius:8px;padding:15px}.option-grid h3{margin:3px 0 9px;font-size:16px}.option-grid p{margin:8px 0;color:#415868}.tag{font-size:11px;color:#587463}@media(max-width:700px){.option-grid{grid-template-columns:1fr}}
</style></head><body>
<header><div><strong>Mengine · 三端项目流程图</strong><p>${catalog.date} · ${rendered.length} 张流程图 · 开发基线 ${catalog.head.slice(0, 8)}</p></div><div><a href="开源替代研判.html">开源替代研判</a><a href="#O01">替代总图</a><a href="01-功能流程.md">功能文档</a><a href="02-实现流程.md">实现文档</a><a href="03-功能清单.md">功能清单</a></div></header>
<div class="layout"><aside><input id="search" type="search" placeholder="查找功能或实现" aria-label="查找流程图"><nav>${nav}</nav></aside><main><p class="boundary">F 图新增开源候选标注 · O 图为接入方案 · I 图为当前实现。候选尚未安装或切换；开发基线与原运行基线 ${catalog.runtimeHead.slice(0, 8)} 分别记录。</p>${articles}<div class="footer"><button id="previous">← 上一张</button><span id="position"></span><button id="next">下一张 →</button></div></main></div>
<script>
const ids=${JSON.stringify(rendered.map(d => d.id))};let selected=ids[0];const scales=new Map();
function current(){return document.getElementById('panel-'+selected)}
function resize(mode){const panel=current(),svg=panel.querySelector('svg'),box=panel.querySelector('.diagram-scroll');const width=svg.viewBox.baseVal.width;let factor=scales.get(selected)||1;if(mode==='fit')factor=Math.min(1,(box.clientWidth-54)/width);else if(mode==='whole')factor=Math.min(1,(box.clientWidth-54)/width,(innerHeight*.7-54)/svg.viewBox.baseVal.height);else if(mode==='larger')factor=Math.min(2.5,factor*1.2);else if(mode==='smaller')factor=Math.max(.08,factor/1.2);factor=Math.max(.08,factor);scales.set(selected,factor);svg.style.width=(width*factor)+'px';panel.querySelector('.scale').textContent=Math.round(factor*100)+'%'}
function show(id){if(!ids.includes(id))id=ids[0];selected=id;document.querySelectorAll('article[data-diagram]').forEach(p=>p.hidden=p.dataset.diagram!==id);document.querySelectorAll('nav a').forEach(a=>{if(a.dataset.id===id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});const n=ids.indexOf(id);document.getElementById('position').textContent=(n+1)+' / '+ids.length;document.getElementById('previous').disabled=n===0;document.getElementById('next').disabled=n===ids.length-1;resize(scales.has(id)?'keep':'fit')}
window.addEventListener('hashchange',()=>show(location.hash.slice(1)));window.addEventListener('resize',()=>resize('fit'));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>resize(b.dataset.action)));
document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('nav a').forEach(a=>a.hidden=!(a.textContent+' '+a.dataset.search).toLowerCase().includes(q))});
document.getElementById('previous').onclick=()=>{location.hash=ids[Math.max(0,ids.indexOf(selected)-1)]};document.getElementById('next').onclick=()=>{location.hash=ids[Math.min(ids.length-1,ids.indexOf(selected)+1)]};show(location.hash.slice(1));
</script></body></html>`;
await fs.writeFile(path.join(here, 'index.html'), html.replace(/[ \t]+$/gm, ''));
console.log(`Rendered ${rendered.length} verified SVG diagrams and offline index.html.`);

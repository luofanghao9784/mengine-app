const groups = {
  input: {
    title: '输入',
    subtitle: '让资料成为可用的工作上下文',
    icon: 'input',
    color: '#9ebbc6',
    index: '01',
    description: '外部取数、资料解析与检索分别登记。资料可被使用，仍须遵守企业与工作空间的访问权限。',
    channels: ['外部取数', '资料解析', '资料检索任务'],
  },
  process: {
    title: '处理',
    subtitle: '把上下文转化为工作成果',
    icon: 'process',
    color: '#b6abd0',
    index: '02',
    description: '会话与画报任务使用获权上下文执行工作；企业信息分析独立登记。工作完成不等于成果已共享。',
    channels: ['会话与画报任务', '企业信息分析'],
  },
  output: {
    title: '输出',
    subtitle: '让工作成果抵达使用者',
    icon: 'output',
    color: '#cbbca0',
    index: '03',
    description: '会话流式输出与成果导出分别观测。读取资料、完成执行与发布共享成果是不同动作。',
    channels: ['会话流式输出', '成果导出'],
  },
  memory: {
    title: '经验积累',
    subtitle: '从工作反馈中积累可用经验',
    icon: 'memory',
    color: '#a4bca8',
    index: '04',
    description: '经验提炼、通用清洗与总库调整按各自核验流程推进。它们属于日常维护，不代表独立自进化已启用。',
    channels: ['经验提炼与核验', '通用经验清洗', '总库调整核验'],
  },
};
// 全部为合成分类汇总；每个运行类别只计入一组。r/q/w/u/f/c 分别为执行/排队/等待/待核对/失败/近五分钟完成。
const row = (r, q, w, u, f, c) => ({ r, q, w, u, f, c });
const scenarios = {
  busy: {
    title: '正在协同运行',
    caption: '四组能力，围绕每一次工作交付',
    core: '能力协同 · 有序运行',
    time: '14:32:08',
    groups: {
      input: [row(1, 0, 0, 0, 0, 6), row(2, 1, 0, 0, 0, 12), row(2, 0, 0, 0, 0, 18)],
      process: [row(7, 2, 1, 0, 0, 28), row(1, 0, 0, 0, 0, 4)],
      output: [row(2, 0, 0, 0, 0, 23), row(1, 0, 0, 0, 0, 5)],
      memory: [row(1, 1, 1, 0, 0, 5), row(1, 0, 0, 0, 0, 3), row(0, 0, 0, 0, 0, 2)],
    },
  },
  idle: {
    title: '当前没有执行中的记录',
    caption: '暂无排队任务 · 空闲不代表服务健康检查',
    core: '静候下一项工作',
    time: '14:38:12',
    groups: {
      input: [row(0, 0, 0, 0, 0, 2), row(0, 0, 0, 0, 0, 3), row(0, 0, 0, 0, 0, 6)],
      process: [row(0, 0, 0, 0, 0, 8), row(0, 0, 0, 0, 0, 1)],
      output: [row(0, 0, 0, 0, 0, 7), row(0, 0, 0, 0, 0, 2)],
      memory: [row(0, 0, 0, 0, 0, 1), row(0, 0, 0, 0, 0, 1), row(0, 0, 0, 0, 0, 0)],
    },
  },
  fault: {
    title: '输入与经验积累需要关注',
    caption: '保留异常 3 项 · 结果待核对 1 项',
    core: '工作继续 · 部分异常',
    time: '14:35:26',
    groups: {
      input: [row(1, 0, 0, 0, 0, 6), row(0, 3, 0, 0, 2, 8), row(2, 0, 0, 0, 0, 18)],
      process: [row(5, 2, 2, 0, 0, 24), row(1, 0, 0, 0, 0, 4)],
      output: [row(2, 0, 0, 0, 0, 20), row(0, 1, 0, 1, 0, 3)],
      memory: [row(1, 1, 1, 0, 0, 3), row(0, 0, 0, 0, 1, 1), row(0, 0, 0, 0, 0, 2)],
    },
  },
  offline: {
    title: '运行快照暂不可用',
    caption: '连接已中断 · 当前运行状态未知',
    core: '等待重新获取快照',
    time: '—',
    groups: null,
  },
};
let mode = 'busy',
  selected = 'process',
  paused = false;
const $ = (id) => document.getElementById(id);
const total = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
function selectGroup(key) {
  selected = key;
  render();
  $('announcement').textContent = `已查看${groups[key].title}运行详情`;
}
function render() {
  const s = scenarios[mode],
    offline = !s.groups;
  document.body.dataset.scenario = mode;
  $('status-title').textContent = s.title;
  $('status-caption').textContent = s.caption;
  $('core-caption').textContent = s.core;
  const all = offline ? [] : Object.values(s.groups).flat();
  Object.entries({ running: 'r', queued: 'q', waiting: 'w', unknown: 'u', failed: 'f' }).forEach(
    ([label, key]) => ($('metric-' + label).textContent = offline ? '—' : total(all, key)),
  );
  $('core-number').textContent = offline ? '—' : total(all, 'r');
  $('core-state').textContent = offline ? '状态未知' : '登记执行中';
  $('snapshot-time').textContent = s.time;
  document
    .querySelectorAll('[data-mode]')
    .forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.mode === mode)));
  document.querySelectorAll('[data-group]').forEach((el) => {
    const key = el.dataset.group,
      rows = offline ? [] : s.groups[key],
      r = total(rows, 'r'),
      f = total(rows, 'f'),
      u = total(rows, 'u');
    el.classList.toggle('selected', key === selected);
    el.classList.toggle('has-error', f > 0 || u > 0);
    el.setAttribute('aria-pressed', String(key === selected));
    el.querySelector('[data-count]').textContent = offline ? '—' : r;
    el.querySelector('[data-state]').textContent = offline
      ? '快照不可用'
      : f
        ? `${f} 项保留异常`
        : u
          ? `${u} 项结果待核对`
          : r
            ? `${r} 项执行中`
            : '暂无执行中记录';
  });
  const g = groups[selected],
    rows = offline ? [] : s.groups[selected];
  document.querySelector('.inspector').style.setProperty('--detail-color', g.color);
  $('detail-title').textContent = g.title;
  $('detail-subtitle').textContent = g.subtitle;
  $('detail-index').textContent = g.index + ' / 04';
  $('detail-icon').setAttribute('href', '#i-' + g.icon);
  $('detail-description').textContent = g.description;
  $('detail-running').textContent = offline ? '—' : total(rows, 'r');
  $('detail-completed').textContent = offline ? '—' : total(rows, 'c');
  $('channel-list').innerHTML = g.channels
    .map((name, i) => {
      const r = rows[i];
      return `<div class="channel"><div class="channel-top"><span>${name}</span><span class="channel-count">${offline ? '—' : r.r} <em>/ ${offline ? '—' : r.q}</em></span></div><div class="channel-bar"><i style="width:${offline ? 0 : (r.r / Math.max(1, ...rows.map((x) => x.r))) * 100}%"></i></div>${!offline && (r.f || r.u) ? `<p class="channel-error">${r.f ? `保留异常 ${r.f} 项` : ''}${r.f && r.u ? ' · ' : ''}${r.u ? `结果待核对 ${r.u} 项` : ''}</p>` : ''}</div>`;
    })
    .join('');
  const f = total(rows, 'f'),
    u = total(rows, 'u'),
    w = total(rows, 'w'),
    q = total(rows, 'q');
  $('detail-notice').classList.toggle('warning', f > 0 || u > 0 || offline);
  $('detail-notice').textContent = offline
    ? '无法读取当前快照。计数显示为未知，不将断开解释为空闲。'
    : f
      ? `保留异常 ${f} 项。异常记录不等于新增告警，也不表示已自动重试。`
      : u
        ? `结果待核对 ${u} 项。收到明确回执前，不计作完成或失败。`
        : q || w
          ? `排队 ${q} 项 · 等待 / 部分完成 ${w} 项。不同状态分别计数。`
          : '当前分组暂无排队、等待或保留异常记录。';
  $('recent-items').innerHTML = [
    ['input', '资料解析', 1],
    ['process', '会话与画报任务', 0],
    ['output', '成果导出', 1],
  ]
    .map(
      ([key, label, index]) =>
        `<div class="recent-item"><svg aria-hidden="true"><use href="#i-${groups[key].icon}"/></svg><div><strong>${label}</strong><p>${offline ? '快照不可用 · 完成数未知' : `近 5 分钟完成 <b>${s.groups[key][index].c}</b> 项`}</p></div></div>`,
    )
    .join('');
  $('observation-note').innerHTML = offline
    ? '看不见运行数据时，<br>也应清楚地表达未知。'
    : mode === 'fault'
      ? '让异常出现在视线里，<br>让正常工作继续被看见。'
      : '运行中的工作可被看见，<br>积累下来的经验同样可被追踪。';
}
document
  .querySelectorAll('[data-group]')
  .forEach((el) => el.addEventListener('click', () => selectGroup(el.dataset.group)));
document.querySelectorAll('[data-mode]').forEach((el) =>
  el.addEventListener('click', () => {
    mode = el.dataset.mode;
    render();
    $('announcement').textContent = `已切换到${el.textContent}模拟场景`;
  }),
);
$('open-errors').addEventListener('click', () => {
  const s = scenarios[mode];
  const key = s.groups && Object.keys(groups).find((k) => total(s.groups[k], 'f') > 0);
  if (key) {
    selectGroup(key);
    document.querySelector(`[data-group="${key}"]`).focus();
  } else {
    $('announcement').textContent =
      mode === 'offline' ? '当前快照不可用，异常数未知' : '当前模拟场景没有保留异常';
  }
});
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');
function updateMotion() {
  document.body.classList.toggle('motion-paused', paused);
  $('motion-toggle').setAttribute('aria-pressed', String(paused || prefersReduced.matches));
  $('motion-toggle').querySelector('span').textContent = prefersReduced.matches
    ? '已减少动态效果'
    : paused
      ? '播放动效'
      : '暂停动效';
  $('motion-toggle').disabled = prefersReduced.matches;
}
$('motion-toggle').addEventListener('click', () => {
  paused = !paused;
  updateMotion();
});
prefersReduced.addEventListener('change', updateMotion);
// 原创 SVG 球体：固定几何曲线，不载入第三方视频/图片，也不把装饰动画解释为实时任务流。
const ns = 'http://www.w3.org/2000/svg';
for (let i = 0; i < 38; i++) {
  const el = document.createElementNS(ns, 'ellipse');
  el.setAttribute('cx', '150');
  el.setAttribute('cy', '150');
  el.setAttribute('rx', String(18 + 91 * Math.abs(Math.sin((i / 38) * Math.PI))));
  el.setAttribute('ry', '109');
  el.setAttribute('transform', `rotate(${i * 4.73} 150 150)`);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'url(#filament)');
  el.setAttribute('stroke-width', '.55');
  el.setAttribute('opacity', String(0.22 + (i % 5) * 0.09));
  $('filaments').append(el);
}
render();
updateMotion();

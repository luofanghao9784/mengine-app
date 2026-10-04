/** Synthetic layout only: no identity, API requests, business data or model calls. */
import { createRoot } from 'react-dom/client';
import { MagazineGrid } from '../../../src/briefing-live/MagazineGrid';
import { MagazineBody } from '../../../src/briefing-live/Magazine';
import '../../../src/styles.css';
import '../../../src/identity/access.css';
import '../../../src/identity/workspace.css';
import '../../../src/briefing-live/briefing.css';

createRoot(document.getElementById('root')!).render(
  <div className="access-shell workspace-shell workspace-briefing">
    <aside className="access-sidebar" aria-label="合成导航" />
    <section className="access-main">
      <header className="topbar">
        <h1>智能画报 · 合成验证</h1>
      </header>
      <main className="access-content">
        <section className="live-briefing">
          <MagazineGrid
            items={[
              {
                id: 'synthetic-insight',
                title: '合成洞察卡片',
                summary: '仅用于排版验证',
                fixedSize: '1×2',
                render: (
                  <article className="live-briefing-card">
                    <button className="live-briefing-body" aria-label="合成洞察卡片">
                      <MagazineBody
                        title="合成洞察卡片"
                        excerpt="这是合成摘要，用于验证卡片与滚动条之间的尺寸更新是否稳定。"
                        truncated={false}
                        workspace="合成空间"
                        date="2026-10-03T00:00:00Z"
                      />
                    </button>
                  </article>
                ),
              },
              {
                id: 'synthetic-more',
                title: '',
                summary: '',
                fixedSize: '1×1',
                render: (
                  <article className="live-briefing-card">
                    <div className="live-briefing-body">发现新内容 · 合成占位</div>
                  </article>
                ),
              },
            ]}
          />
        </section>
      </main>
    </section>
  </div>,
);

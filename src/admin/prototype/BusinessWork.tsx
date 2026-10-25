import './business-work.css';

export function OutputWork({ tenant }: { tenant: string }) {
  const links: [string, string, string][] = [
    ['智能画报', 'briefing', '查看本人获权的画报与依据，继续讨论或生成'],
    ['会话回复', 'conversations', '继续本人会话，查看执行状态与回复'],
    ['成果文件', 'documents', '查看本人生成的文稿、版本及保存记录'],
  ];
  return (
    <section className="cards glass business-work" aria-label="输出">
      <article className="card">
        <header>
          <h2>输出与成果</h2>
        </header>
        <p>按当前账号与工作空间权限打开成果。企业管理身份不会公开其他员工的私人会话。</p>
        <div className="output-links">
          {links.map(([name, view, description]) => (
            <a
              key={view}
              target="_top"
              href={`/workspace/#tenant=${encodeURIComponent(tenant)}&view=${view}`}
            >
              <h3>{name}</h3>
              <p>{description}</p>
              <span>打开 →</span>
            </a>
          ))}
        </div>
      </article>
    </section>
  );
}

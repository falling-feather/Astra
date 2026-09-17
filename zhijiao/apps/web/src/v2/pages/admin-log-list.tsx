import type { AdminLogEntry } from "../admin-models";

export function AdminLogList({
  title,
  description,
  entries,
  technical,
}: {
  title: string;
  description: string;
  entries: AdminLogEntry[];
  technical: boolean;
}) {
  return (
    <main className="v2-admin-page">
      <header className="v2-admin-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        <span>{entries.length} 条</span>
      </header>
      {entries.length === 0 ? (
        <section className="v2-admin-empty">
          <h2>当前没有记录</h2>
          <p>系统产生真实运行数据后才会显示。</p>
        </section>
      ) : (
        <section className="v2-admin-log-list">
          {entries.map((entry) => (
            <article key={entry.id} className={entry.level}>
              <time dateTime={entry.occurredAt}>
                {new Date(entry.occurredAt).toLocaleString("zh-CN")}
              </time>
              <span>{entry.category}</span>
              <p>{entry.summary}</p>
              {technical ? (
                <code>
                  {entry.technicalRef}
                  {entry.provider ? ` · ${entry.provider}` : ""}
                </code>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

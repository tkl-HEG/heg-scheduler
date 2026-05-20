import { PageHeader } from "../components/PageHeader";
import { StatusMessage } from "../components/StatusMessage";
import { getDashboardData } from "../lib/data";
import { formatCount } from "../lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { stats, issues } = await getDashboardData();

  return (
    <>
      <PageHeader title="Dashboard" />
      <StatusMessage issues={issues} />
      <section className="metric-grid">
        {stats.map((stat) => (
          <article className="metric-card" key={stat.table}>
            <span>{stat.label}</span>
            <strong>{formatCount(stat.value)}</strong>
          </article>
        ))}
      </section>
    </>
  );
}

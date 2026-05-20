import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getReviewSummaryData } from "../../lib/reviewData";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { cards, issues } = await getReviewSummaryData();

  return (
    <>
      <PageHeader title="Review" />
      <StatusMessage issues={issues} />

      <section className="info-box">Dette er et review-overblik. Rettelser kommer i næste fase.</section>

      <section className="metric-grid">
        {cards.map((card) => (
          <Link className="metric-card metric-link" href={card.href} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </Link>
        ))}
      </section>
    </>
  );
}

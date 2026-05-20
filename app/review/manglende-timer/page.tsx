import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import { getMissingHoursReviewData } from "../../../lib/reviewData";

export const dynamic = "force-dynamic";

export default async function MissingHoursPage() {
  const { rows, issues } = await getMissingHoursReviewData();

  return (
    <>
      <PageHeader title="Manglende timer" />
      <StatusMessage issues={issues} />
      <section className="info-box">Dette er et review-overblik. Rettelser kommer i næste fase.</section>
      <DataTable
        columns={["Hold", "Fag", "Kategori/program", "Campus", "Timer", "Kilde", "Muligt match", "Severity", "Note"]}
        rows={rows.map((row) => [
          asText(row.class_name),
          <span key="subject">
            {asText(row.subject_name)}
            <small>{asText(row.subject_key)}</small>
          </span>,
          asText(row.category_program),
          asText(row.campus),
          asText(row.total_hours),
          asText(row.hours_source),
          asText(row.possible_match),
          <span className={`badge badge-${row.severity === "error" ? "error" : "warning"}`} key="severity">
            {asText(row.severity)}
          </span>,
          asText(row.note)
        ])}
      />
    </>
  );
}

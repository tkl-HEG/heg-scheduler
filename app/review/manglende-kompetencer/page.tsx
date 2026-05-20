import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import { getMissingCompetenciesReviewData } from "../../../lib/reviewData";

export const dynamic = "force-dynamic";

export default async function MissingCompetenciesPage() {
  const { rows, issues } = await getMissingCompetenciesReviewData();

  return (
    <>
      <PageHeader title="Manglende kompetencer" />
      <StatusMessage issues={issues} />
      <section className="info-box">Dette er et review-overblik. Rettelser kommer i næste fase.</section>
      <DataTable
        columns={["Hold", "Fag", "Lærer", "Initialer", "Foreslået", "Mulig årsag", "Severity"]}
        rows={rows.map((row) => [
          asText(row.class_name),
          asText(row.subject_name),
          asText(row.teacher_name),
          <strong key="initials">{asText(row.teacher_initials)}</strong>,
          row.was_suggested ? "Ja" : "Nej",
          asText(row.possible_reason),
          <span className={`badge badge-${row.severity === "error" ? "error" : "warning"}`} key="severity">
            {asText(row.severity)}
          </span>
        ])}
      />
    </>
  );
}

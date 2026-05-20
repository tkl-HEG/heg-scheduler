import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import { getMissingAssignmentsReviewData } from "../../../lib/reviewData";

export const dynamic = "force-dynamic";

export default async function MissingAssignmentsPage() {
  const { rows, issues } = await getMissingAssignmentsReviewData();

  return (
    <>
      <PageHeader title="Manglende fagfordeling" />
      <StatusMessage issues={issues} />
      <section className="info-box">Dette er et review-overblik. Rettelser kommer i næste fase.</section>
      <DataTable
        columns={["Hold", "Fag", "Kategori/program", "Campus", "Foreslåede lærere", "Kompetente lærere", "Status"]}
        rows={rows.map((row) => [
          asText(row.class_name),
          <span key="subject">
            {asText(row.subject_name)}
            <small>{asText(row.subject_key)}</small>
          </span>,
          asText(row.category_program),
          asText(row.campus),
          asText(row.suggested_teachers),
          asText(row.competent_teachers),
          <span className={`badge badge-${row.severity === "error" ? "error" : "warning"}`} key="status">
            {row.note || "Mangler fagfordeling"}
          </span>
        ])}
      />
    </>
  );
}

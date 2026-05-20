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
      <section className="info-box">
        Denne side ændrer ikke data. Den hjælper med at beslutte, hvilke fagudbud der skal have timetal, og hvilke der
        kun er container-/programfag.
      </section>
      <DataTable
        columns={[
          "Hold",
          "Fag",
          "Kategori/program",
          "Campus",
          "Timer",
          "Kilde",
          "Klassifikation",
          "Anbefalet handling",
          "Foreslået timetal",
          "Muligt match",
          "Begrundelse",
          "Påvirker belastning",
          "Severity",
          "Note"
        ]}
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
          <span className="badge badge-info" key="classification">
            {asText(row.missing_hours_classification)}
          </span>,
          asText(row.recommended_action),
          asText(row.suggested_hours),
          asText(row.possible_match),
          asText(row.classification_reason),
          row.affects_teacher_load ? "Ja" : "Nej",
          <span className={`badge badge-${row.severity === "error" ? "error" : "warning"}`} key="severity">
            {asText(row.severity)}
          </span>,
          asText(row.note)
        ])}
      />
    </>
  );
}

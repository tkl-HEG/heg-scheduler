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
      <section className="info-box">
        Denne side ændrer ikke data. Den hjælper med at afgøre, om en kompetence skal tilføjes til læreren, eller om
        fagfordelingen skal ændres.
      </section>
      <DataTable
        columns={[
          "Hold",
          "Fag",
          "Lærerinitialer",
          "Lærernavn",
          "Kategori/program",
          "Campus",
          "Fagfordelte timer",
          "Pseudo-resource",
          "Suggested teacher",
          "Andre kompetente lærere",
          "Anbefalet handling",
          "Severity",
          "Begrundelse"
        ]}
        rows={rows.map((row) => [
          asText(row.class_name),
          asText(row.subject_name),
          <strong key="initials">{asText(row.teacher_initials)}</strong>,
          asText(row.teacher_name),
          asText(row.category_program),
          asText(row.campus),
          row.assigned_hours_known === null ? "-" : asText(Number(row.assigned_hours_known.toFixed(1))),
          row.is_pseudo_resource ? "Ja" : "Nej",
          row.was_suggested ? "Ja" : "Nej",
          asText(row.competent_teachers),
          <span className="badge badge-info" key="action">
            {asText(row.recommended_action)}
          </span>,
          <span
            className={`badge badge-${row.severity === "error" ? "error" : row.severity === "info" ? "info" : "warning"}`}
            key="severity"
          >
            {asText(row.severity)}
          </span>,
          asText(row.possible_reason)
        ])}
      />
    </>
  );
}

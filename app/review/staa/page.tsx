import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { getStaaReviewData } from "../../../lib/data";
import { asText } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function ReviewStaaPage() {
  const { rows, issues } = await getStaaReviewData();

  return (
    <>
      <PageHeader title="STÅ review" />
      <StatusMessage issues={issues} />
      <section className="info-box">
        Dette er et review-overblik. Rettelser kommer i næste fase. STÅ Aars/Hobro vises som fælles STÅ-program,
        mens kohorten stadig kræver review.
      </section>

      <div className="review-stack">
        {rows.map((row) => (
          <section className="review-panel" key={row.id}>
            <div className="review-heading">
              <div>
                <h2>{asText(row.name)}</h2>
                <p>
                  {asText(row.program_code)} · {asText(row.category_key)} · {asText(row.campus_name)}
                </p>
              </div>
              <span className="badge badge-warning">{asText(row.cohort_confidence, "review")}</span>
            </div>

            <dl className="definition-grid">
              <div>
                <dt>Education program</dt>
                <dd>{asText(row.program_name)}</dd>
              </div>
              <div>
                <dt>Mulige kohorter</dt>
                <dd>{asText(row.possible_cohort_types)}</dd>
              </div>
              <div>
                <dt>Sammenlæsning</dt>
                <dd>{asText(row.combined_teaching_group_key)}</dd>
              </div>
              <div>
                <dt>Aktive uger</dt>
                <dd>
                  {row.active_weeks_count} ({row.active_weeks_range})
                </dd>
              </div>
            </dl>

            <h3>Fagudbud</h3>
            <DataTable
              columns={["Fag", "Timer", "Timer mangler", "Sammenlæsningsnøgle"]}
              rows={row.offerings.map((offering) => [
                <span key="subject">
                  {asText(offering.subject_name)}
                  <small>{asText(offering.subject_key)}</small>
                </span>,
                asText(offering.total_hours),
                offering.hours_missing ? "Ja" : "Nej",
                asText(offering.metadata?.combined_teaching_group_key)
              ])}
            />

            <h3>Warnings</h3>
            <DataTable
              columns={["Type", "Severity", "Besked"]}
              rows={row.warnings.map((warning) => [
                asText(warning.warning_type),
                asText(warning.severity),
                asText(warning.message)
              ])}
            />
          </section>
        ))}
      </div>
    </>
  );
}

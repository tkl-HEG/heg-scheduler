import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { asText, formatDate } from "../../lib/format";
import { getWorkloadOverviewData } from "../../lib/workloadData";

export const dynamic = "force-dynamic";

function hours(value: number | null) {
  if (value === null || value === undefined) return "Mangler årsnorm";
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(value);
}

function statusBadge(status: string, isPseudoResource: boolean) {
  if (isPseudoResource) {
    return <span className="badge badge-info">Pseudo-ressource</span>;
  }

  const badgeClass =
    status === "missing_allocation" || status === "missing_assignment_hours"
      ? "badge-warning"
      : status === "over_allocated"
        ? "badge-error"
        : "badge-info";

  return <span className={`badge ${badgeClass}`}>{status}</span>;
}

export default async function WorkloadPage() {
  const { activeYear, periods, rows, issues } = await getWorkloadOverviewData();

  return (
    <>
      <PageHeader title="Opgaveoversigt" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Dette er en read-only visning af den årlige opgaveoversigt. Fagfordeling og skemalægning er stadig næste faser.
      </section>

      <section className="content-section">
        <h2>Aktivt skoleår</h2>
        <dl className="definition-grid">
          <div>
            <dt>Skoleår</dt>
            <dd>{asText(activeYear?.label)}</dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd>{formatDate(activeYear?.starts_on)}</dd>
          </div>
          <div>
            <dt>Slut</dt>
            <dd>{formatDate(activeYear?.ends_on)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{activeYear?.is_active ? "Aktiv" : "Ikke aktiv"}</dd>
          </div>
        </dl>
      </section>

      <section className="content-section">
        <h2>Perioder</h2>
        <DataTable
          columns={["Periode", "Type", "Start", "Slut"]}
          rows={periods.map((period) => [
            asText(period.label),
            asText(period.period_type),
            formatDate(period.starts_on),
            formatDate(period.ends_on)
          ])}
        />
      </section>

      <section className="content-section">
        <h2>Lærerbelastning</h2>
        <DataTable
          columns={["Initialer", "Navn", "Årsnorm", "Fagfordelte timer", "Manglende timer", "Rest", "Status"]}
          rows={rows.map((row) => [
            <strong key="initials">{asText(row.initials)}</strong>,
            asText(row.display_name),
            row.allocated_hours === null ? <span className="badge badge-warning">Mangler årsnorm</span> : hours(row.allocated_hours),
            hours(row.assigned_hours_known),
            row.assigned_hours_missing,
            row.is_pseudo_resource ? "-" : hours(row.remaining_hours),
            statusBadge(row.status, row.is_pseudo_resource)
          ])}
        />
      </section>
    </>
  );
}

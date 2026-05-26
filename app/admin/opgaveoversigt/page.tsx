import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText, formatDate } from "../../../lib/format";
import { getWorkloadOverviewData } from "../../../lib/workloadData";
import { AdminWorkloadClient } from "./AdminWorkloadClient";

export const dynamic = "force-dynamic";

export default async function AdminWorkloadPage() {
  const { activeYear, rows, issues } = await getWorkloadOverviewData();

  return (
    <>
      <PageHeader title="Admin: opgaveoversigt" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Admin-redigering af lærer-årstimer. Owner/admin/editor kan ændre årsnormer; viewer og ikke-loggede brugere ser
        read-only fallback. Alle ændringer går gennem server-side rollecheck og audit-log.
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

      <AdminWorkloadClient rows={rows} />
    </>
  );
}

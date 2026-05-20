import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getImportStatusData } from "../../lib/data";
import { asText, formatDate, sortGroupedCounts } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function ImportStatusPage() {
  const { imports, groupedWarnings, reviewWarnings, issues } = await getImportStatusData();

  return (
    <>
      <PageHeader title="Importstatus" />
      <StatusMessage issues={issues} />

      <section className="content-section">
        <h2>Seneste imports</h2>
        <DataTable
          columns={["Dato", "Kilde", "Navn", "Version"]}
          rows={imports.map((row) => [
            formatDate(row.imported_at),
            asText(row.source_kind),
            asText(row.source_name),
            asText(row.import_version)
          ])}
        />
      </section>

      <section className="content-section">
        <h2>Warnings efter type</h2>
        <DataTable
          columns={["Type / severity", "Antal"]}
          rows={sortGroupedCounts(groupedWarnings).map(([label, count]) => [label, count])}
        />
      </section>

      <section className="content-section">
        <h2>Review-warnings</h2>
        <DataTable
          columns={["Type", "Severity", "Kilde", "Række", "Besked", "Status"]}
          rows={reviewWarnings.map((warning) => [
            asText(warning.warning_type),
            <span className={`badge badge-${warning.severity || "warning"}`} key="severity">
              {asText(warning.severity)}
            </span>,
            asText(warning.source_sheet),
            asText(warning.source_row),
            asText(warning.message),
            warning.resolved ? "Løst" : "Åben"
          ])}
        />
      </section>
    </>
  );
}

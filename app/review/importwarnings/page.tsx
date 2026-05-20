import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import { getImportWarningsReviewData, parseImportWarningFilters } from "../../../lib/reviewData";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ImportWarningsReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = parseImportWarningFilters(params);
  const { rows, warningTypes, severities, sources, issues } = await getImportWarningsReviewData(filters);

  return (
    <>
      <PageHeader title="Importwarnings" />
      <StatusMessage issues={issues} />
      <section className="info-box">Dette er et review-overblik. Rettelser kommer i næste fase.</section>

      <form className="filter-bar" method="get">
        <label>
          Warning type
          <select name="warningType" defaultValue={filters.warningType}>
            <option value="">Alle</option>
            {warningTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select name="source" defaultValue={filters.source}>
            <option value="">Alle</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select name="severity" defaultValue={filters.severity}>
            <option value="">Alle</option>
            {severities.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>
        <label>
          Søg
          <input name="q" defaultValue={filters.q} />
        </label>
        <button type="submit">Vis</button>
      </form>

      <DataTable
        columns={["Type", "Severity", "Source", "Entity", "Sheet/række", "Message", "Status"]}
        rows={rows.map((row) => [
          asText(row.warning_type),
          <span className={`badge badge-${row.severity === "error" ? "error" : row.severity === "info" ? "info" : "warning"}`} key="severity">
            {asText(row.severity)}
          </span>,
          asText(row.source),
          asText(row.entity),
          [row.source_sheet, row.source_row].filter(Boolean).join(" / ") || "-",
          asText(row.message),
          row.resolved ? "Løst" : "Åben"
        ])}
      />
    </>
  );
}

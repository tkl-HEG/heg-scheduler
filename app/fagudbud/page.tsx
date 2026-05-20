import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getOfferingsData } from "../../lib/data";
import { asText } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function OfferingsPage() {
  const { rows, issues } = await getOfferingsData();

  return (
    <>
      <PageHeader title="Fagudbud" />
      <StatusMessage issues={issues} />
      <DataTable
        columns={["Hold", "Fag", "Timer", "Timer mangler", "Kilde", "Lærere", "Forslag"]}
        rows={rows.map((row) => [
          asText(row.class_name),
          <span key="subject">
            {asText(row.subject_name)}
            <small>{asText(row.subject_key)}</small>
          </span>,
          asText(row.total_hours),
          row.hours_missing ? <span className="badge badge-warning">Ja</span> : "Nej",
          asText(row.hours_source),
          asText(row.teachers),
          asText(row.suggested_teachers)
        ])}
      />
    </>
  );
}

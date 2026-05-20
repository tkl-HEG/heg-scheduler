import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getClassesData } from "../../lib/data";
import { asText } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  const { rows, issues } = await getClassesData();

  return (
    <>
      <PageHeader title="Hold" />
      <StatusMessage issues={issues} />
      <DataTable
        columns={["Hold", "Kategori", "Program", "Adresse", "Aktive uger", "Fagudbud", "Warnings"]}
        rows={rows.map((row) => [
          <span key="name">
            <strong>{asText(row.name)}</strong>
            <small>{asText(row.legacy_id)}</small>
          </span>,
          <span key="category">
            {asText(row.category_name)}
            <small>{asText(row.category_key)}</small>
          </span>,
          <span key="program">
            {asText(row.program_name)}
            <small>{asText(row.program_code)}</small>
          </span>,
          asText(row.campus_name),
          `${row.active_weeks_count} (${row.active_weeks_range})`,
          row.subject_offerings_count,
          row.warning_count
        ])}
      />
    </>
  );
}

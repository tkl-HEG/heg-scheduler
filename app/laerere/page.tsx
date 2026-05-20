import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getTeachersData } from "../../lib/data";
import { asText } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function TeachersPage() {
  const { rows, issues } = await getTeachersData();

  return (
    <>
      <PageHeader title="Lærere" />
      <StatusMessage issues={issues} />
      <DataTable
        columns={["Initialer", "Navn", "Kompetenceoversigt", "Kompetencer", "Fagfordelinger"]}
        rows={rows.map((row) => [
          <strong key="initials">{asText(row.initials)}</strong>,
          asText(row.display_name),
          asText(row.skills_summary),
          row.competencies_count,
          row.assignments_count
        ])}
      />
    </>
  );
}

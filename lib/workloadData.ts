import { readRows } from "./supabase";

type Row = Record<string, any>;

export type WorkloadStatusRow = {
  teacher_id: string;
  initials: string;
  display_name: string | null;
  allocated_hours: number | null;
  assigned_hours_known: number;
  assigned_hours_missing: number;
  remaining_hours: number | null;
  status: string;
  is_pseudo_resource: boolean;
};

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getWorkloadOverviewData() {
  const [years, periods, status] = await Promise.all([
    readRows<Row>("workload_years", "id,label,starts_on,ends_on,is_active,metadata", {
      order: "starts_on",
      ascending: false,
      limit: 20
    }),
    readRows<Row>("workload_periods", "id,workload_year_id,label,period_type,starts_on,ends_on,metadata", {
      order: "starts_on",
      ascending: true,
      limit: 100
    }),
    readRows<Row>(
      "v_teacher_workload_status",
      "workload_year_id,workload_year_label,teacher_id,initials,display_name,is_pseudo_resource,allocated_hours,assigned_hours_known,assigned_hours_missing,remaining_hours,status",
      { order: "initials", ascending: true, limit: 1000 }
    )
  ]);

  const activeYear = years.data.find((year) => year.is_active) || years.data[0] || null;
  const activeYearId = activeYear?.id || null;
  const activeLabel = activeYear?.label || null;
  const activePeriods = periods.data.filter((period) => period.workload_year_id === activeYearId);

  const statusRows = status.data
    .filter((row) => !activeYearId || row.workload_year_id === activeYearId || row.workload_year_label === activeLabel)
    .map((row): WorkloadStatusRow => ({
      teacher_id: row.teacher_id,
      initials: row.initials,
      display_name: row.display_name ?? null,
      allocated_hours: toNumber(row.allocated_hours),
      assigned_hours_known: toNumber(row.assigned_hours_known) ?? 0,
      assigned_hours_missing: toNumber(row.assigned_hours_missing) ?? 0,
      remaining_hours: toNumber(row.remaining_hours),
      status: row.status || "unknown",
      is_pseudo_resource: Boolean(row.is_pseudo_resource)
    }));

  return {
    activeYear,
    periods: activePeriods,
    rows: statusRows,
    issues: issuesFrom([years, periods, status])
  };
}

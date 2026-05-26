import { readRows } from "./supabase";

type Row = Record<string, any>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export type WorkloadStatusRow = {
  workload_year_id: string;
  workload_year_label: string;
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeInitials(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("da-DK");
}

function isPseudoResource(teacher: Row) {
  return Boolean(
    teacher.metadata?.is_pseudo_teacher ||
      teacher.metadata?.is_resource ||
      teacher.metadata?.is_pseudo_resource
  );
}

function teacherLikeFromStatusRow(row: Row): Row {
  return {
    id: row.teacher_id,
    school_id: null,
    initials: row.initials,
    display_name: row.display_name ?? null,
    metadata: {
      is_pseudo_resource: Boolean(row.is_pseudo_resource),
      source: "v_teacher_workload_status"
    }
  };
}

function remainingHours({
  allocatedHours,
  assignedHoursKnown,
  assignedHoursMissing,
  isPseudo
}: {
  allocatedHours: number | null;
  assignedHoursKnown: number;
  assignedHoursMissing: number;
  isPseudo: boolean;
}) {
  if (isPseudo || allocatedHours === null) return null;
  return allocatedHours - assignedHoursKnown - assignedHoursMissing;
}

function workloadStatus({
  allocatedHours,
  assignedHoursKnown,
  assignedHoursMissing,
  isPseudo
}: {
  allocatedHours: number | null;
  assignedHoursKnown: number;
  assignedHoursMissing: number;
  isPseudo: boolean;
}) {
  if (isPseudo) return "pseudo_resource_not_counted";
  if (allocatedHours === null) return "missing_allocation";
  if (assignedHoursMissing > 0) return "missing_assignment_hours";

  const remaining = allocatedHours - assignedHoursKnown - assignedHoursMissing;

  if (remaining < 0) return "over_allocated";
  if (remaining > 0) return "under_allocated";
  return "on_target";
}

export async function getWorkloadOverviewData() {
  const [years, periods, status, teachers, allocations] = await Promise.all([
    readRows<Row>("workload_years", "id,school_id,label,starts_on,ends_on,is_active,metadata", {
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
    ),
    readRows<Row>("teachers", "id,school_id,initials,display_name,metadata", {
      order: "initials",
      ascending: true,
      limit: 1000
    }),
    readRows<Row>("teacher_workload_allocations", "id,workload_year_id,teacher_id,allocated_hours,metadata", {
      order: "teacher_id",
      ascending: true,
      limit: 2000
    })
  ]);

  const activeYear = years.data.find((year) => year.is_active) || years.data[0] || null;
  const activeYearId = activeYear?.id || null;
  const activeLabel = activeYear?.label || null;
  const activeSchoolId = activeYear?.school_id || null;
  const activePeriods = periods.data.filter((period) => period.workload_year_id === activeYearId);

  const activeStatusRows = status.data.filter(
    (row) => !activeYearId || row.workload_year_id === activeYearId || row.workload_year_label === activeLabel
  );
  const statusByTeacherId = new Map(activeStatusRows.filter((row) => isUuid(row.teacher_id)).map((row) => [row.teacher_id, row]));
  const statusByInitials = new Map(activeStatusRows.map((row) => [normalizeInitials(row.initials), row]));
  const allocationByTeacherId = new Map(
    allocations.data
      .filter((row) => row.workload_year_id === activeYearId && isUuid(row.teacher_id))
      .map((row) => [row.teacher_id, row])
  );
  const teachersForActiveSchool =
    activeSchoolId && activeYearId
      ? teachers.data.filter((teacher) => teacher.school_id === activeSchoolId && isUuid(teacher.id))
      : [];
  const sourceTeachers = teachersForActiveSchool.length
    ? teachersForActiveSchool
    : activeStatusRows.filter((row) => isUuid(row.teacher_id)).map(teacherLikeFromStatusRow);

  const statusRows = sourceTeachers.map((teacher): WorkloadStatusRow => {
    const statusRow = statusByTeacherId.get(teacher.id) || statusByInitials.get(normalizeInitials(teacher.initials));
    const allocation = allocationByTeacherId.get(teacher.id);
    const allocatedHours = toNumber(allocation?.allocated_hours ?? statusRow?.allocated_hours);
    const assignedHoursKnown = toNumber(statusRow?.assigned_hours_known) ?? 0;
    const assignedHoursMissing = toNumber(statusRow?.assigned_hours_missing) ?? 0;
    const pseudoResource = Boolean(statusRow?.is_pseudo_resource) || isPseudoResource(teacher);

    return {
      workload_year_id: activeYearId || "",
      workload_year_label: activeLabel || "",
      teacher_id: teacher.id,
      initials: teacher.initials,
      display_name: teacher.display_name ?? null,
      allocated_hours: allocatedHours,
      assigned_hours_known: assignedHoursKnown,
      assigned_hours_missing: assignedHoursMissing,
      remaining_hours: remainingHours({
        allocatedHours,
        assignedHoursKnown,
        assignedHoursMissing,
        isPseudo: pseudoResource
      }),
      status: workloadStatus({
        allocatedHours,
        assignedHoursKnown,
        assignedHoursMissing,
        isPseudo: pseudoResource
      }),
      is_pseudo_resource: pseudoResource
    };
  });

  return {
    activeYear,
    periods: activePeriods,
    rows: statusRows,
    issues: issuesFrom([years, periods, status, teachers, allocations])
  };
}

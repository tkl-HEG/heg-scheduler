import { readRows } from "./supabase";

type Row = Record<string, any>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export type WorkloadDebugInfo = {
  active_workload_year_found: boolean;
  view_rows: number;
  active_view_rows: number;
  teachers: number;
  allocations: number;
};

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uuidFrom(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("da-DK");
}

function teacherIsPseudoResource(teacher: Row | undefined) {
  return Boolean(
    teacher?.metadata?.is_pseudo_teacher ||
      teacher?.metadata?.is_resource ||
      teacher?.metadata?.is_pseudo_resource
  );
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
  isPseudo,
  viewStatus
}: {
  allocatedHours: number | null;
  assignedHoursKnown: number;
  assignedHoursMissing: number;
  isPseudo: boolean;
  viewStatus: string | null | undefined;
}) {
  if (viewStatus) return viewStatus;
  if (isPseudo) return "pseudo_resource_not_counted";
  if (allocatedHours === null) return "missing_allocation";
  if (assignedHoursMissing > 0) return "missing_assignment_hours";

  const remaining = allocatedHours - assignedHoursKnown - assignedHoursMissing;

  if (remaining < 0) return "over_allocated";
  if (remaining > 0) return "under_allocated";
  return "on_target";
}

function findTeacherForStatusRow(row: Row, teachers: Row[]) {
  const statusTeacherId = uuidFrom(row.teacher_id);

  if (statusTeacherId) {
    const byId = teachers.find((teacher) => uuidFrom(teacher.id) === statusTeacherId);
    if (byId) return byId;
  }

  const initials = normalize(row.initials);
  if (initials) {
    const byInitials = teachers.find((teacher) => normalize(teacher.initials) === initials);
    if (byInitials) return byInitials;
  }

  const displayName = normalize(row.display_name);
  if (displayName) {
    return teachers.find((teacher) => normalize(teacher.display_name) === displayName) || null;
  }

  return null;
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
  const activeWorkloadYearId = uuidFrom(activeYearId);
  const activeLabel = activeYear?.label || null;
  const activePeriods = periods.data.filter((period) => period.workload_year_id === activeYearId);

  const activeStatusRows = status.data.filter(
    (row) =>
      !activeWorkloadYearId ||
      uuidFrom(row.workload_year_id) === activeWorkloadYearId ||
      row.workload_year_label === activeLabel
  );
  const viewRows = activeStatusRows.length ? activeStatusRows : status.data;
  const allocationByTeacherId = new Map(
    allocations.data
      .filter((row) => uuidFrom(row.workload_year_id) === activeWorkloadYearId && uuidFrom(row.teacher_id))
      .map((row) => [uuidFrom(row.teacher_id)!, row])
  );

  const statusRows = viewRows.map((statusRow): WorkloadStatusRow => {
    const teacher = findTeacherForStatusRow(statusRow, teachers.data);
    const teacherId = uuidFrom(teacher?.id) || uuidFrom(statusRow.teacher_id) || "";
    const allocation = teacherId ? allocationByTeacherId.get(teacherId) : null;
    const allocatedHours = toNumber(allocation?.allocated_hours ?? statusRow.allocated_hours);
    const assignedHoursKnown = toNumber(statusRow.assigned_hours_known) ?? 0;
    const assignedHoursMissing = toNumber(statusRow.assigned_hours_missing) ?? 0;
    const pseudoResource = Boolean(statusRow.is_pseudo_resource) || teacherIsPseudoResource(teacher || undefined);

    return {
      workload_year_id: activeWorkloadYearId || uuidFrom(statusRow.workload_year_id) || "",
      workload_year_label: activeLabel || statusRow.workload_year_label || "",
      teacher_id: teacherId,
      initials: statusRow.initials || teacher?.initials || "",
      display_name: statusRow.display_name ?? teacher?.display_name ?? null,
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
        isPseudo: pseudoResource,
        viewStatus: statusRow.status
      }),
      is_pseudo_resource: pseudoResource
    };
  });

  return {
    activeYear,
    periods: activePeriods,
    rows: statusRows,
    debug: {
      active_workload_year_found: Boolean(activeYear),
      view_rows: status.data.length,
      active_view_rows: activeStatusRows.length,
      teachers: teachers.data.length,
      allocations: allocations.data.length
    } satisfies WorkloadDebugInfo,
    issues: issuesFrom([years, periods, status, teachers, allocations])
  };
}

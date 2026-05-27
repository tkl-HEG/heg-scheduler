import { readRows } from "./supabase";

type Row = Record<string, any>;

export type AdminHoldSchoolRow = {
  id: string;
  name: string;
  slug: string | null;
  organization_id: string | null;
  source: "schools" | "active_workload_year" | "class_groups";
};

export type AdminHoldOptionRow = {
  id: string;
  label: string;
  detail: string | null;
};

export type AdminHoldRow = {
  id: string;
  school_id: string;
  school_name: string;
  legacy_id: string | null;
  name: string;
  address_label: string;
  campus_id: string | null;
  campus_name: string;
  class_category_id: string | null;
  category_name: string;
  category_key: string | null;
  education_program_id: string | null;
  program_name: string;
  program_code: string | null;
  default_period_weeks: number | null;
  planning_notes: string | null;
  scheduling_notes: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
  active_weeks_count: number;
  active_weeks_range: string;
  subject_offerings_count: number;
  requirement_count: number;
  calendar_event_count: number;
  status_label: string;
};

export type AdminHoldsSchemaInfo = {
  table: "class_groups";
  found_fields: string[];
  editable_fields: string[];
  missing_lifecycle_fields: string[];
  related_tables: string[];
  supports_deactivation: boolean;
  deactivation_field: "is_active" | null;
  current_offering_model: string;
};

const BASE_HOLD_FIELDS = [
  "id",
  "school_id",
  "campus_id",
  "legacy_id",
  "name",
  "address_label",
  "preferred_room_id",
  "default_period_weeks",
  "class_category_id",
  "education_program_id",
  "planning_notes",
  "scheduling_notes",
  "metadata",
  "created_at",
  "updated_at"
];
const LIFECYCLE_FIELDS = ["is_active", "archived_at", "archived_by", "archived_reason"];
const HOLD_SELECT_WITH_LIFECYCLE = [...BASE_HOLD_FIELDS, ...LIFECYCLE_FIELDS].join(",");
const HOLD_SELECT_BASE = BASE_HOLD_FIELDS.join(",");

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function mapById<T extends Row>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function groupRows<T extends Row>(rows: T[], key: string) {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const value = row[key];
    if (!value) return acc;
    acc[value] = acc[value] || [];
    acc[value].push(row);
    return acc;
  }, {});
}

function countBy(rows: Row[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    if (!value) return acc;
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function uniqueValues(rows: Row[], key: string) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean) as string[])];
}

function weekSummary(rows: Row[]) {
  const weeks = rows.map((row) => Number(row.week_no)).filter((week) => Number.isFinite(week));

  if (!weeks.length) {
    return { count: 0, range: "-" };
  }

  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  return {
    count: sorted.length,
    range: `${sorted[0]}-${sorted[sorted.length - 1]}`
  };
}

function schemaInfo(supportsLifecycle: boolean): AdminHoldsSchemaInfo {
  return {
    table: "class_groups",
    found_fields: supportsLifecycle ? [...BASE_HOLD_FIELDS, ...LIFECYCLE_FIELDS] : BASE_HOLD_FIELDS,
    editable_fields: [
      "name",
      "legacy_id",
      "address_label",
      "campus_id",
      "class_category_id",
      "education_program_id",
      "default_period_weeks",
      "planning_notes",
      "scheduling_notes"
    ],
    missing_lifecycle_fields: supportsLifecycle ? [] : ["is_active", "archived_at", "archived_by", "archived_reason"],
    related_tables: ["subject_offerings", "education_requirements", "class_active_weeks", "planning_calendar_events"],
    supports_deactivation: supportsLifecycle,
    deactivation_field: supportsLifecycle ? "is_active" : null,
    current_offering_model: "subject_offerings has one class_group_id; multi-hold co-teaching requires a later offering/group model extension."
  };
}

async function readHolds() {
  const withLifecycle = await readRows<Row>("class_groups", HOLD_SELECT_WITH_LIFECYCLE, {
    order: "name",
    limit: 3000
  });

  if (!withLifecycle.issue) {
    return { result: withLifecycle, supportsLifecycle: true };
  }

  const base = await readRows<Row>("class_groups", HOLD_SELECT_BASE, {
    order: "name",
    limit: 3000
  });

  return {
    result: {
      data: base.data,
      issue: base.issue ? base.issue : `Lifecycle-felter mangler endnu: ${withLifecycle.issue}`
    },
    supportsLifecycle: false
  };
}

function fallbackSchoolName(source: AdminHoldSchoolRow["source"], detail?: string | null) {
  if (source === "active_workload_year") {
    return detail ? `Skole fra aktivt skoleår (${detail})` : "Skole fra aktivt skoleår";
  }

  if (source === "class_groups") {
    return "Skole fra eksisterende hold";
  }

  return "Skole";
}

function resolveSchools(input: { schools: Row[]; workloadYears: Row[]; holds: Row[] }): AdminHoldSchoolRow[] {
  if (input.schools.length) {
    return input.schools.map((school): AdminHoldSchoolRow => ({
      id: school.id,
      name: school.name,
      slug: school.slug ?? null,
      organization_id: school.organization_id ?? null,
      source: "schools"
    }));
  }

  const activeWorkloadYear = input.workloadYears.find((year) => year.is_active) || input.workloadYears[0] || null;

  if (activeWorkloadYear?.school_id) {
    return [
      {
        id: activeWorkloadYear.school_id,
        name: fallbackSchoolName("active_workload_year", activeWorkloadYear.label),
        slug: null,
        organization_id: null,
        source: "active_workload_year"
      }
    ];
  }

  const holdSchoolIds = uniqueValues(input.holds, "school_id");

  if (holdSchoolIds.length === 1) {
    return [
      {
        id: holdSchoolIds[0],
        name: fallbackSchoolName("class_groups"),
        slug: null,
        organization_id: null,
        source: "class_groups"
      }
    ];
  }

  return [];
}

export async function getAdminHoldsData() {
  const [holdRead, schools, workloadYears, campuses, categories, programs, activeWeeks, offerings, requirements, calendarEvents] =
    await Promise.all([
      readHolds(),
      readRows<Row>("schools", "id,name,slug,organization_id", { order: "name", limit: 100 }),
      readRows<Row>("workload_years", "id,school_id,label,is_active", { order: "starts_on", ascending: false, limit: 20 }),
      readRows<Row>("campuses", "id,name,legacy_label", { order: "name", limit: 500 }),
      readRows<Row>("class_categories", "id,name,normalized_key", { order: "name", limit: 500 }),
      readRows<Row>("education_programs", "id,code,name", { order: "code", limit: 500 }),
      readRows<Row>("class_active_weeks", "class_group_id,week_no", { limit: 10000 }),
      readRows<Row>("subject_offerings", "id,class_group_id", { limit: 10000 }),
      readRows<Row>("education_requirements", "id,class_group_id", { limit: 10000 }),
      readRows<Row>("planning_calendar_events", "id,class_group_id", { limit: 10000 })
    ]);

  const holds = holdRead.result;
  const resolvedSchools = resolveSchools({ schools: schools.data, workloadYears: workloadYears.data, holds: holds.data });
  const schoolMap = mapById(resolvedSchools);
  const campusMap = mapById(campuses.data);
  const categoryMap = mapById(categories.data);
  const programMap = mapById(programs.data);
  const activeWeeksByHold = groupRows(activeWeeks.data, "class_group_id");
  const offeringsByHold = countBy(offerings.data, "class_group_id");
  const requirementsByHold = countBy(requirements.data, "class_group_id");
  const calendarEventsByHold = countBy(calendarEvents.data, "class_group_id");
  const schema = schemaInfo(holdRead.supportsLifecycle);

  const holdRows = holds.data.map((hold): AdminHoldRow => {
    const school = schoolMap.get(hold.school_id);
    const campus = campusMap.get(hold.campus_id);
    const category = categoryMap.get(hold.class_category_id);
    const program = programMap.get(hold.education_program_id);
    const active = weekSummary(activeWeeksByHold[hold.id] || []);
    const isActive = hold.is_active !== false;

    return {
      id: hold.id,
      school_id: hold.school_id,
      school_name: school?.name || school?.slug || "-",
      legacy_id: hold.legacy_id ?? null,
      name: hold.name,
      address_label: hold.address_label || "",
      campus_id: hold.campus_id ?? null,
      campus_name: campus?.name || hold.address_label || "-",
      class_category_id: hold.class_category_id ?? null,
      category_name: category?.name || hold.metadata?.possible_category || "-",
      category_key: category?.normalized_key || null,
      education_program_id: hold.education_program_id ?? null,
      program_name: program?.name || hold.metadata?.common_education_program_code || "-",
      program_code: program?.code || null,
      default_period_weeks: hold.default_period_weeks ?? null,
      planning_notes: hold.planning_notes ?? null,
      scheduling_notes: hold.scheduling_notes ?? null,
      metadata: hold.metadata || {},
      is_active: isActive,
      archived_at: hold.archived_at ?? null,
      archived_by: hold.archived_by ?? null,
      archived_reason: hold.archived_reason ?? null,
      created_at: hold.created_at,
      updated_at: hold.updated_at,
      active_weeks_count: active.count,
      active_weeks_range: active.range,
      subject_offerings_count: offeringsByHold[hold.id] || 0,
      requirement_count: requirementsByHold[hold.id] || 0,
      calendar_event_count: calendarEventsByHold[hold.id] || 0,
      status_label: schema.supports_deactivation ? (isActive ? "Aktiv" : "Inaktiv") : "Ingen statusfelt"
    };
  });

  return {
    holds: holdRows,
    schools: resolvedSchools,
    campuses: campuses.data.map((campus): AdminHoldOptionRow => ({
      id: campus.id,
      label: campus.name,
      detail: campus.legacy_label ?? null
    })),
    categories: categories.data.map((category): AdminHoldOptionRow => ({
      id: category.id,
      label: category.name,
      detail: category.normalized_key ?? null
    })),
    programs: programs.data.map((program): AdminHoldOptionRow => ({
      id: program.id,
      label: program.name,
      detail: program.code ?? null
    })),
    schema,
    issues: issuesFrom([holds, schools, workloadYears, campuses, categories, programs, activeWeeks, offerings, requirements, calendarEvents])
  };
}

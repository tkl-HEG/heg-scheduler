import { readRows } from "./supabase";

type Row = Record<string, any>;
export type PeriodUnit = "weeks" | "days";
export type SubjectPriority = "high" | "medium" | "low";

export type AdminSubjectOfferingSchoolRow = {
  id: string;
  name: string;
  slug: string | null;
  organization_id: string | null;
  source: "schools" | "active_workload_year" | "subject_offerings";
};

export type AdminSubjectOfferingSubjectOption = {
  id: string;
  school_id: string;
  name: string;
  normalized_key: string | null;
};

export type AdminSubjectOfferingClassGroupOption = {
  id: string;
  school_id: string;
  name: string;
  legacy_id: string | null;
  address_label: string | null;
};

export type AdminSubjectOfferingClassGroupRow = {
  subject_offering_id: string;
  class_group_id: string;
  school_id: string;
  member_role: string;
  sort_order: number | null;
  class_group_name: string;
  class_group_legacy_id: string | null;
};

export type AdminSubjectOfferingRow = {
  id: string;
  school_id: string;
  school_name: string;
  legacy_id: string | null;
  class_group_id: string;
  course_subject_id: string;
  pairing_group_id: string | null;
  pairing_group_name: string | null;
  name: string;
  subject_name: string;
  subject_key: string | null;
  total_hours: number | string | null;
  hours_missing: boolean;
  hours_source: string | null;
  period_value: number;
  period_unit: PeriodUnit;
  start_week: number;
  priority: SubjectPriority;
  sort_order: number | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
  legacy_class_group_name: string;
  class_groups: AdminSubjectOfferingClassGroupRow[];
  class_group_ids: string[];
  is_shared: boolean;
  assignment_count: number;
  suggestion_count: number;
  status_label: string;
};

export type AdminSubjectOfferingsSchemaInfo = {
  table: "subject_offerings";
  found_fields: string[];
  editable_fields: string[];
  timer_fields: string[];
  period_fields: string[];
  teacher_relation_fields: string[];
  missing_lifecycle_fields: string[];
  related_tables: string[];
  related_views: string[];
  join_table: "subject_offering_class_groups";
  supports_deactivation: boolean;
  deactivation_field: "is_active" | null;
  legacy_primary_field: "class_group_id";
};

const BASE_OFFERING_FIELDS = [
  "id",
  "school_id",
  "legacy_id",
  "class_group_id",
  "course_subject_id",
  "pairing_group_id",
  "name",
  "total_hours",
  "hours_missing",
  "hours_source",
  "period_value",
  "period_unit",
  "start_week",
  "priority",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at"
];
const LIFECYCLE_FIELDS = ["is_active", "archived_at", "archived_by", "archived_reason"];
const OFFERING_SELECT_WITH_LIFECYCLE = [...BASE_OFFERING_FIELDS, ...LIFECYCLE_FIELDS].join(",");
const OFFERING_SELECT_BASE = BASE_OFFERING_FIELDS.join(",");

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

function toNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function schemaInfo(supportsLifecycle: boolean): AdminSubjectOfferingsSchemaInfo {
  return {
    table: "subject_offerings",
    found_fields: supportsLifecycle ? [...BASE_OFFERING_FIELDS, ...LIFECYCLE_FIELDS] : BASE_OFFERING_FIELDS,
    editable_fields: [
      "course_subject_id",
      "subject_offering_class_groups.class_group_id",
      "total_hours",
      "hours_missing",
      "hours_source",
      "period_value",
      "period_unit",
      "start_week",
      "priority",
      "sort_order"
    ],
    timer_fields: ["total_hours", "hours_missing", "hours_source"],
    period_fields: ["period_value", "period_unit", "start_week"],
    teacher_relation_fields: ["teaching_assignments.subject_offering_id", "teacher_suggestions.subject_offering_id"],
    missing_lifecycle_fields: supportsLifecycle ? [] : ["is_active", "archived_at", "archived_by", "archived_reason"],
    related_tables: [
      "course_subjects",
      "class_groups",
      "subject_offering_class_groups",
      "teaching_assignments",
      "teacher_suggestions",
      "subject_pairing_groups"
    ],
    related_views: [
      "v_subject_status",
      "v_subject_warnings",
      "v_requirement_status",
      "v_class_planning_status",
      "v_generation_ready_classes",
      "v_teacher_workload_status"
    ],
    join_table: "subject_offering_class_groups",
    supports_deactivation: supportsLifecycle,
    deactivation_field: supportsLifecycle ? "is_active" : null,
    legacy_primary_field: "class_group_id"
  };
}

async function readOfferings() {
  const withLifecycle = await readRows<Row>("subject_offerings", OFFERING_SELECT_WITH_LIFECYCLE, {
    order: "name",
    limit: 3000
  });

  if (!withLifecycle.issue) {
    return { result: withLifecycle, supportsLifecycle: true };
  }

  const base = await readRows<Row>("subject_offerings", OFFERING_SELECT_BASE, {
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

function fallbackSchoolName(source: AdminSubjectOfferingSchoolRow["source"], detail?: string | null) {
  if (source === "active_workload_year") {
    return detail ? `Skole fra aktivt skoleår (${detail})` : "Skole fra aktivt skoleår";
  }

  if (source === "subject_offerings") {
    return "Skole fra eksisterende fagudbud";
  }

  return "Skole";
}

function resolveSchools(input: { schools: Row[]; workloadYears: Row[]; offerings: Row[] }): AdminSubjectOfferingSchoolRow[] {
  if (input.schools.length) {
    return input.schools.map((school): AdminSubjectOfferingSchoolRow => ({
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

  const schoolIds = uniqueValues(input.offerings, "school_id");

  if (schoolIds.length === 1) {
    return [
      {
        id: schoolIds[0],
        name: fallbackSchoolName("subject_offerings"),
        slug: null,
        organization_id: null,
        source: "subject_offerings"
      }
    ];
  }

  return [];
}

function membershipRows(input: {
  offeringId: string;
  memberships: Row[];
  classesById: Map<string, Row>;
  fallbackClassGroupId: string | null;
}): AdminSubjectOfferingClassGroupRow[] {
  const rows = input.memberships
    .map((membership): AdminSubjectOfferingClassGroupRow | null => {
      const classGroup = input.classesById.get(membership.class_group_id);
      if (!classGroup) return null;

      return {
        subject_offering_id: input.offeringId,
        class_group_id: membership.class_group_id,
        school_id: membership.school_id,
        member_role: membership.member_role || "shared",
        sort_order: membership.sort_order ?? null,
        class_group_name: classGroup.name || "-",
        class_group_legacy_id: classGroup.legacy_id ?? null
      };
    })
    .filter(Boolean) as AdminSubjectOfferingClassGroupRow[];

  if (rows.length || !input.fallbackClassGroupId) {
    return rows.sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.class_group_name.localeCompare(b.class_group_name, "da"));
  }

  const fallbackClass = input.classesById.get(input.fallbackClassGroupId);
  if (!fallbackClass) return [];

  return [
    {
      subject_offering_id: input.offeringId,
      class_group_id: fallbackClass.id,
      school_id: fallbackClass.school_id,
      member_role: "legacy_primary",
      sort_order: 1,
      class_group_name: fallbackClass.name || "-",
      class_group_legacy_id: fallbackClass.legacy_id ?? null
    }
  ];
}

export async function getAdminSubjectOfferingsData() {
  const [
    offeringRead,
    schools,
    workloadYears,
    subjects,
    classGroups,
    memberships,
    assignments,
    suggestions,
    pairingGroups
  ] = await Promise.all([
    readOfferings(),
    readRows<Row>("schools", "id,name,slug,organization_id", { order: "name", limit: 100 }),
    readRows<Row>("workload_years", "id,school_id,label,is_active", { order: "starts_on", ascending: false, limit: 20 }),
    readRows<Row>("course_subjects", "id,school_id,name,normalized_key", { order: "name", limit: 3000 }),
    readRows<Row>("class_groups", "id,school_id,legacy_id,name,address_label", { order: "name", limit: 3000 }),
    readRows<Row>(
      "subject_offering_class_groups",
      "subject_offering_id,class_group_id,school_id,member_role,sort_order,metadata,created_at,updated_at",
      { order: "sort_order", limit: 10000 }
    ),
    readRows<Row>("teaching_assignments", "subject_offering_id", { limit: 20000 }),
    readRows<Row>("teacher_suggestions", "subject_offering_id", { limit: 20000 }),
    readRows<Row>("subject_pairing_groups", "id,school_id,legacy_pairing_id,name", { order: "name", limit: 3000 })
  ]);

  const offerings = offeringRead.result;
  const resolvedSchools = resolveSchools({ schools: schools.data, workloadYears: workloadYears.data, offerings: offerings.data });
  const schoolMap = mapById(resolvedSchools);
  const subjectMap = mapById(subjects.data);
  const classGroupMap = mapById(classGroups.data);
  const pairingGroupMap = mapById(pairingGroups.data);
  const membershipsByOffering = groupRows(memberships.data, "subject_offering_id");
  const assignmentCounts = countBy(assignments.data, "subject_offering_id");
  const suggestionCounts = countBy(suggestions.data, "subject_offering_id");
  const schema = schemaInfo(offeringRead.supportsLifecycle);

  const offeringRows = offerings.data.map((offering): AdminSubjectOfferingRow => {
    const school = schoolMap.get(offering.school_id);
    const subject = subjectMap.get(offering.course_subject_id);
    const legacyClass = classGroupMap.get(offering.class_group_id);
    const classMemberships = membershipRows({
      offeringId: offering.id,
      memberships: membershipsByOffering[offering.id] || [],
      classesById: classGroupMap,
      fallbackClassGroupId: offering.class_group_id
    });
    const isActive = offering.is_active !== false;
    const pairingGroup = pairingGroupMap.get(offering.pairing_group_id);

    return {
      id: offering.id,
      school_id: offering.school_id,
      school_name: school?.name || school?.slug || "-",
      legacy_id: offering.legacy_id ?? null,
      class_group_id: offering.class_group_id,
      course_subject_id: offering.course_subject_id,
      pairing_group_id: offering.pairing_group_id ?? null,
      pairing_group_name: pairingGroup?.name || pairingGroup?.legacy_pairing_id || null,
      name: offering.name,
      subject_name: subject?.name || offering.name || "-",
      subject_key: subject?.normalized_key ?? null,
      total_hours: offering.total_hours ?? null,
      hours_missing: Boolean(offering.hours_missing),
      hours_source: offering.hours_source ?? null,
      period_value: toNumber(offering.period_value, 1),
      period_unit: offering.period_unit === "days" ? "days" : "weeks",
      start_week: toNumber(offering.start_week, 1),
      priority: offering.priority === "high" || offering.priority === "low" ? offering.priority : "medium",
      sort_order: offering.sort_order ?? null,
      metadata: offering.metadata || {},
      is_active: isActive,
      archived_at: offering.archived_at ?? null,
      archived_by: offering.archived_by ?? null,
      archived_reason: offering.archived_reason ?? null,
      created_at: offering.created_at,
      updated_at: offering.updated_at,
      legacy_class_group_name: legacyClass?.name || "-",
      class_groups: classMemberships,
      class_group_ids: classMemberships.map((membership) => membership.class_group_id),
      is_shared: classMemberships.length > 1,
      assignment_count: assignmentCounts[offering.id] || 0,
      suggestion_count: suggestionCounts[offering.id] || 0,
      status_label: schema.supports_deactivation ? (isActive ? "Aktiv" : "Inaktiv") : "Ingen statusfelt"
    };
  });

  return {
    offerings: offeringRows,
    schools: resolvedSchools,
    subjects: subjects.data.map((subject): AdminSubjectOfferingSubjectOption => ({
      id: subject.id,
      school_id: subject.school_id,
      name: subject.name,
      normalized_key: subject.normalized_key ?? null
    })),
    classGroups: classGroups.data.map((classGroup): AdminSubjectOfferingClassGroupOption => ({
      id: classGroup.id,
      school_id: classGroup.school_id,
      name: classGroup.name,
      legacy_id: classGroup.legacy_id ?? null,
      address_label: classGroup.address_label ?? null
    })),
    schema,
    issues: issuesFrom([
      offerings,
      schools,
      workloadYears,
      subjects,
      classGroups,
      memberships,
      assignments,
      suggestions,
      pairingGroups
    ])
  };
}

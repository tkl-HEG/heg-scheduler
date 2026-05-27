import { readRows } from "./supabase";

type Row = Record<string, any>;

export type AdminSchoolRow = {
  id: string;
  name: string;
  slug: string | null;
  organization_id: string | null;
  source: "schools" | "active_workload_year" | "course_subjects";
};

export type AdminCourseSubjectRow = {
  id: string;
  school_id: string;
  school_name: string;
  name: string;
  normalized_key: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
  competency_count: number;
  offering_count: number;
  requirement_count: number;
  status_label: string;
};

export type AdminCourseSubjectsSchemaInfo = {
  table: "course_subjects";
  found_fields: string[];
  editable_fields: string[];
  missing_lifecycle_fields: string[];
  related_tables: string[];
  supports_deactivation: boolean;
  deactivation_field: "is_active" | null;
};

const BASE_SUBJECT_FIELDS = ["id", "school_id", "name", "normalized_key", "metadata", "created_at", "updated_at"];
const LIFECYCLE_FIELDS = ["is_active", "archived_at", "archived_by", "archived_reason"];
const SUBJECT_SELECT_WITH_LIFECYCLE = [...BASE_SUBJECT_FIELDS, ...LIFECYCLE_FIELDS].join(",");
const SUBJECT_SELECT_BASE = BASE_SUBJECT_FIELDS.join(",");

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function mapById<T extends Row>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
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

function schemaInfo(supportsLifecycle: boolean): AdminCourseSubjectsSchemaInfo {
  return {
    table: "course_subjects",
    found_fields: supportsLifecycle ? [...BASE_SUBJECT_FIELDS, ...LIFECYCLE_FIELDS] : BASE_SUBJECT_FIELDS,
    editable_fields: ["name", "normalized_key"],
    missing_lifecycle_fields: supportsLifecycle ? [] : ["is_active", "archived_at", "archived_by", "archived_reason"],
    related_tables: ["teacher_competencies", "subject_offerings", "education_requirements"],
    supports_deactivation: supportsLifecycle,
    deactivation_field: supportsLifecycle ? "is_active" : null
  };
}

async function readSubjects() {
  const withLifecycle = await readRows<Row>("course_subjects", SUBJECT_SELECT_WITH_LIFECYCLE, {
    order: "name",
    limit: 3000
  });

  if (!withLifecycle.issue) {
    return { result: withLifecycle, supportsLifecycle: true };
  }

  const base = await readRows<Row>("course_subjects", SUBJECT_SELECT_BASE, {
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

function fallbackSchoolName(source: AdminSchoolRow["source"], detail?: string | null) {
  if (source === "active_workload_year") {
    return detail ? `Skole fra aktivt skoleår (${detail})` : "Skole fra aktivt skoleår";
  }

  if (source === "course_subjects") {
    return "Skole fra eksisterende fag";
  }

  return "Skole";
}

function resolveSchools(input: { schools: Row[]; workloadYears: Row[]; subjects: Row[] }): AdminSchoolRow[] {
  if (input.schools.length) {
    return input.schools.map((school): AdminSchoolRow => ({
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

  const subjectSchoolIds = uniqueValues(input.subjects, "school_id");

  if (subjectSchoolIds.length === 1) {
    return [
      {
        id: subjectSchoolIds[0],
        name: fallbackSchoolName("course_subjects"),
        slug: null,
        organization_id: null,
        source: "course_subjects"
      }
    ];
  }

  return [];
}

export async function getAdminCourseSubjectsData() {
  const [subjectRead, schools, workloadYears, competencies, offerings, requirements] = await Promise.all([
    readSubjects(),
    readRows<Row>("schools", "id,name,slug,organization_id", { order: "name", limit: 100 }),
    readRows<Row>("workload_years", "id,school_id,label,is_active", { order: "starts_on", ascending: false, limit: 20 }),
    readRows<Row>("teacher_competencies", "course_subject_id", { limit: 20000 }),
    readRows<Row>("subject_offerings", "course_subject_id", { limit: 20000 }),
    readRows<Row>("education_requirements", "course_subject_id", { limit: 20000 })
  ]);

  const subjects = subjectRead.result;
  const resolvedSchools = resolveSchools({ schools: schools.data, workloadYears: workloadYears.data, subjects: subjects.data });
  const schoolMap = mapById(resolvedSchools);
  const competenciesBySubject = countBy(competencies.data, "course_subject_id");
  const offeringsBySubject = countBy(offerings.data, "course_subject_id");
  const requirementsBySubject = countBy(requirements.data, "course_subject_id");
  const schema = schemaInfo(subjectRead.supportsLifecycle);

  const subjectRows = subjects.data.map((subject): AdminCourseSubjectRow => {
    const school = schoolMap.get(subject.school_id);
    const isActive = subject.is_active !== false;

    return {
      id: subject.id,
      school_id: subject.school_id,
      school_name: school?.name || school?.slug || "-",
      name: subject.name,
      normalized_key: subject.normalized_key ?? null,
      metadata: subject.metadata || {},
      is_active: isActive,
      archived_at: subject.archived_at ?? null,
      archived_by: subject.archived_by ?? null,
      archived_reason: subject.archived_reason ?? null,
      created_at: subject.created_at,
      updated_at: subject.updated_at,
      competency_count: competenciesBySubject[subject.id] || 0,
      offering_count: offeringsBySubject[subject.id] || 0,
      requirement_count: requirementsBySubject[subject.id] || 0,
      status_label: schema.supports_deactivation ? (isActive ? "Aktiv" : "Inaktiv") : "Ingen statusfelt"
    };
  });

  return {
    subjects: subjectRows,
    schools: resolvedSchools,
    schema,
    issues: issuesFrom([subjects, schools, workloadYears, competencies, offerings, requirements])
  };
}

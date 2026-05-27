import { readRows } from "./supabase";

type Row = Record<string, any>;

export type AdminSchoolRow = {
  id: string;
  name: string;
  slug: string | null;
  organization_id: string;
};

export type AdminCourseSubjectRow = {
  id: string;
  school_id: string;
  school_name: string;
  name: string;
  normalized_key: string | null;
  metadata: Record<string, unknown>;
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
  deactivation_field: string | null;
};

export const adminCourseSubjectsSchema: AdminCourseSubjectsSchemaInfo = {
  table: "course_subjects",
  found_fields: ["id", "school_id", "name", "normalized_key", "metadata", "created_at", "updated_at"],
  editable_fields: ["name", "normalized_key"],
  missing_lifecycle_fields: ["is_active", "status", "archived_at"],
  related_tables: ["teacher_competencies", "subject_offerings", "education_requirements"],
  supports_deactivation: false,
  deactivation_field: null
};

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

export async function getAdminCourseSubjectsData() {
  const [subjects, schools, competencies, offerings, requirements] = await Promise.all([
    readRows<Row>("course_subjects", "id,school_id,name,normalized_key,metadata,created_at,updated_at", {
      order: "name",
      limit: 3000
    }),
    readRows<Row>("schools", "id,name,slug,organization_id", { order: "name", limit: 100 }),
    readRows<Row>("teacher_competencies", "course_subject_id", { limit: 20000 }),
    readRows<Row>("subject_offerings", "course_subject_id", { limit: 20000 }),
    readRows<Row>("education_requirements", "course_subject_id", { limit: 20000 })
  ]);

  const schoolMap = mapById(schools.data);
  const competenciesBySubject = countBy(competencies.data, "course_subject_id");
  const offeringsBySubject = countBy(offerings.data, "course_subject_id");
  const requirementsBySubject = countBy(requirements.data, "course_subject_id");

  const subjectRows = subjects.data.map((subject): AdminCourseSubjectRow => {
    const school = schoolMap.get(subject.school_id);

    return {
      id: subject.id,
      school_id: subject.school_id,
      school_name: school?.name || school?.slug || "-",
      name: subject.name,
      normalized_key: subject.normalized_key ?? null,
      metadata: subject.metadata || {},
      created_at: subject.created_at,
      updated_at: subject.updated_at,
      competency_count: competenciesBySubject[subject.id] || 0,
      offering_count: offeringsBySubject[subject.id] || 0,
      requirement_count: requirementsBySubject[subject.id] || 0,
      status_label: "Ingen statusfelt"
    };
  });

  return {
    subjects: subjectRows,
    schools: schools.data.map((school): AdminSchoolRow => ({
      id: school.id,
      name: school.name,
      slug: school.slug ?? null,
      organization_id: school.organization_id
    })),
    schema: adminCourseSubjectsSchema,
    issues: issuesFrom([subjects, schools, competencies, offerings, requirements])
  };
}

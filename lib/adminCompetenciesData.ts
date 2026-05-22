import { readRows } from "./supabase";

type Row = Record<string, any>;

export type AdminTeacherRow = {
  id: string;
  initials: string;
  display_name: string | null;
  is_pseudo_resource: boolean;
  competency_count: number;
};

export type AdminSubjectRow = {
  id: string;
  name: string;
  normalized_key: string | null;
  competency_count: number;
};

export type AdminCompetencyRow = {
  id: string;
  teacher_id: string;
  course_subject_id: string;
  teacher_label: string;
  subject_name: string;
  level: string;
};

export type AdminCompetencyMatrixRow = {
  teacher: AdminTeacherRow;
  subject_states: {
    subject_id: string;
    subject_name: string;
    has_competency: boolean;
    level: string | null;
  }[];
};

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function mapById(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function countBy(rows: Row[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function isPseudoResourceTeacher(teacher: Row) {
  return (
    teacher.initials === "LSSS" ||
    Boolean(teacher.metadata?.is_pseudo_teacher) ||
    Boolean(teacher.metadata?.is_resource) ||
    teacher.metadata?.resource_type === "self_study"
  );
}

function teacherLabel(teacher: Row | undefined) {
  if (!teacher) return "-";
  return teacher.display_name ? `${teacher.initials} - ${teacher.display_name}` : teacher.initials;
}

export async function getAdminCompetenciesData() {
  const [teachers, subjects, competencies] = await Promise.all([
    readRows<Row>("teachers", "id,initials,display_name,metadata", { order: "initials", limit: 1000 }),
    readRows<Row>("course_subjects", "id,name,normalized_key", { order: "name", limit: 2000 }),
    readRows<Row>("teacher_competencies", "id,teacher_id,course_subject_id,level", { limit: 10000 })
  ]);

  const teacherMap = mapById(teachers.data);
  const subjectMap = mapById(subjects.data);
  const competenciesByTeacher = countBy(competencies.data, "teacher_id");
  const competenciesBySubject = countBy(competencies.data, "course_subject_id");
  const competencyKeyMap = new Map(
    competencies.data.map((competency) => [`${competency.teacher_id}:${competency.course_subject_id}`, competency])
  );

  const teacherRows = teachers.data.map((teacher): AdminTeacherRow => ({
    id: teacher.id,
    initials: teacher.initials,
    display_name: teacher.display_name ?? null,
    is_pseudo_resource: isPseudoResourceTeacher(teacher),
    competency_count: competenciesByTeacher[teacher.id] || 0
  }));

  const subjectRows = subjects.data.map((subject): AdminSubjectRow => ({
    id: subject.id,
    name: subject.name,
    normalized_key: subject.normalized_key ?? null,
    competency_count: competenciesBySubject[subject.id] || 0
  }));

  const competencyRows = competencies.data
    .map((competency): AdminCompetencyRow => ({
      id: competency.id,
      teacher_id: competency.teacher_id,
      course_subject_id: competency.course_subject_id,
      teacher_label: teacherLabel(teacherMap.get(competency.teacher_id)),
      subject_name: subjectMap.get(competency.course_subject_id)?.name || "-",
      level: competency.level || "primary"
    }))
    .sort((a, b) => a.teacher_label.localeCompare(b.teacher_label, "da") || a.subject_name.localeCompare(b.subject_name, "da"));

  const matrixRows = teacherRows.map((teacher): AdminCompetencyMatrixRow => ({
    teacher,
    subject_states: subjectRows.map((subject) => {
      const competency = competencyKeyMap.get(`${teacher.id}:${subject.id}`);
      return {
        subject_id: subject.id,
        subject_name: subject.name,
        has_competency: Boolean(competency),
        level: competency?.level || null
      };
    })
  }));

  return {
    teachers: teacherRows,
    subjects: subjectRows,
    competencies: competencyRows,
    matrix_subjects: subjectRows,
    matrix_rows: matrixRows,
    issues: issuesFrom([teachers, subjects, competencies])
  };
}

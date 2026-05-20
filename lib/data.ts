import { countBy, weekSummary } from "./format";
import { countRows, readRows } from "./supabase";

type Row = Record<string, any>;

type OfferingRow = Row & {
  class_name: string;
  subject_name: string;
  subject_key: string;
  total_hours: string | number | null;
  hours_missing: boolean;
  hours_source: string | null;
  teachers: string[];
  suggested_teachers: string[];
};

type ClassListRow = Row & {
  id: string;
  name: string;
  legacy_id: string | null;
  campus_name: string;
  category_name: string;
  category_key: string;
  program_name: string;
  program_code: string;
  active_weeks_count: number;
  active_weeks_range: string;
  subject_offerings_count: number;
  warning_count: number;
};

type TeacherListRow = Row & {
  id: string;
  legacy_id: string | null;
  initials: string;
  display_name: string | null;
  skills_summary: string | null;
  competencies_count: number;
  assignments_count: number;
};

type StaaReviewOfferingRow = Row & {
  id: string;
  subject_name: string;
  subject_key: string;
  total_hours: string | number | null;
  hours_missing: boolean;
  metadata: Row;
};

type StaaReviewWarningRow = {
  warning_type: string | null;
  severity: string | null;
  message: string;
};

type StaaReviewRow = ClassListRow & {
  active_weeks_count: number;
  active_weeks_range: string;
  possible_cohort_types: string[];
  cohort_type: string | null;
  cohort_confidence: string;
  combined_teaching_group_key: string | null;
  offerings: StaaReviewOfferingRow[];
  warnings: StaaReviewWarningRow[];
  warning_count: number;
};

export const dashboardTables = [
  { table: "teachers", label: "Lærere" },
  { table: "class_groups", label: "Hold" },
  { table: "rooms", label: "Lokaler" },
  { table: "course_subjects", label: "Fag" },
  { table: "subject_offerings", label: "Fagudbud" },
  { table: "education_requirements", label: "Fagkrav" },
  { table: "teacher_competencies", label: "Lærerkompetencer" },
  { table: "teaching_assignments", label: "Fagfordeling" },
  { table: "official_hf_calendar_entries", label: "Officiel HF-kalender" },
  { table: "planning_calendar_events", label: "Planlægningskalender" },
  { table: "import_warnings", label: "Importwarnings" }
];

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function mapById(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function groupRows<T extends Row>(rows: T[], key: string) {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = acc[value] || [];
    acc[value].push(row);
    return acc;
  }, {});
}

function countRowsBy(rows: Row[], key: string) {
  return countBy(rows, (row) => row[key]);
}

function warningMatchesClass(warning: Row, klass: Row) {
  const legacy = String(klass.legacy_id || "");
  const name = String(klass.name || "");
  const message = String(warning.message || "");
  const entityType = String(warning.entity_type || "");
  const entityLegacyId = String(warning.entity_legacy_id || "");

  return (
    entityType.includes("class") &&
    ((legacy && entityLegacyId === legacy) || (name && message.toLowerCase().includes(name.toLowerCase())))
  );
}

export async function getDashboardData() {
  const countResults = await Promise.all(
    dashboardTables.map(async (item) => ({
      ...item,
      ...(await countRows(item.table))
    }))
  );

  return {
    stats: countResults,
    issues: issuesFrom(countResults)
  };
}

export async function getImportStatusData() {
  const [imports, warnings] = await Promise.all([
    readRows<Row>("data_imports", "id,source_kind,source_name,import_version,imported_at,metadata", {
      order: "imported_at",
      ascending: false,
      limit: 20
    }),
    readRows<Row>(
      "import_warnings",
      "id,warning_type,severity,source_sheet,source_row,entity_type,entity_legacy_id,message,resolved,created_at",
      { order: "created_at", ascending: false, limit: 1000 }
    )
  ]);

  const relevantTypes = new Set([
    "class_category_uncertain",
    "class_cohort_uncertain",
    "teacher_missing_competency",
    "missing_hours",
    "subject_missing_hours",
    "missing_assignment",
    "subject_missing_teacher_assignment"
  ]);

  return {
    imports: imports.data,
    groupedWarnings: countBy(warnings.data, (warning) => `${warning.warning_type || "ukendt"} / ${warning.severity || "warning"}`),
    reviewWarnings: warnings.data.filter((warning) => relevantTypes.has(warning.warning_type)),
    issues: issuesFrom([imports, warnings])
  };
}

export async function getClassesData() {
  const [classes, campuses, categories, programs, activeWeeks, offerings, warnings] = await Promise.all([
    readRows<Row>(
      "class_groups",
      "id,legacy_id,name,address_label,campus_id,class_category_id,education_program_id,planning_notes,scheduling_notes,metadata",
      { order: "name", limit: 1000 }
    ),
    readRows<Row>("campuses", "id,name,legacy_label", { order: "name", limit: 500 }),
    readRows<Row>("class_categories", "id,name,normalized_key", { order: "name", limit: 500 }),
    readRows<Row>("education_programs", "id,code,name", { order: "code", limit: 500 }),
    readRows<Row>("class_active_weeks", "class_group_id,week_no", { limit: 5000 }),
    readRows<Row>("subject_offerings", "id,class_group_id", { limit: 5000 }),
    readRows<Row>("import_warnings", "warning_type,entity_type,entity_legacy_id,message,severity", { limit: 2000 })
  ]);

  const campusMap = mapById(campuses.data);
  const categoryMap = mapById(categories.data);
  const programMap = mapById(programs.data);
  const weeksByClass = groupRows(activeWeeks.data, "class_group_id");
  const offeringsByClass = groupRows(offerings.data, "class_group_id");

  const rows = classes.data.map((klass): ClassListRow => {
    const weeks = (weeksByClass[klass.id] || []).map((row) => Number(row.week_no)).filter(Boolean);
    const active = weekSummary(weeks);

    return {
      id: klass.id,
      legacy_id: klass.legacy_id ?? null,
      name: klass.name,
      address_label: klass.address_label,
      campus_id: klass.campus_id,
      class_category_id: klass.class_category_id,
      education_program_id: klass.education_program_id,
      planning_notes: klass.planning_notes,
      scheduling_notes: klass.scheduling_notes,
      metadata: klass.metadata || {},
      campus_name: campusMap.get(klass.campus_id)?.name || klass.address_label || "-",
      category_name: categoryMap.get(klass.class_category_id)?.name || klass.metadata?.possible_category || "-",
      category_key: categoryMap.get(klass.class_category_id)?.normalized_key || klass.metadata?.possible_category_keys?.join(", ") || "-",
      program_name: programMap.get(klass.education_program_id)?.name || klass.metadata?.common_education_program_code || "-",
      program_code: programMap.get(klass.education_program_id)?.code || klass.metadata?.common_education_program_code || "-",
      active_weeks_count: active.count,
      active_weeks_range: active.range,
      subject_offerings_count: offeringsByClass[klass.id]?.length || 0,
      warning_count: warnings.data.filter((warning) => warningMatchesClass(warning, klass)).length
    };
  });

  return { rows, issues: issuesFrom([classes, campuses, categories, programs, activeWeeks, offerings, warnings]) };
}

export async function getTeachersData() {
  const [teachers, competencies, assignments] = await Promise.all([
    readRows<Row>("teachers", "id,legacy_id,initials,display_name,skills_summary,metadata", { order: "initials", limit: 1000 }),
    readRows<Row>("teacher_competencies", "teacher_id", { limit: 5000 }),
    readRows<Row>("teaching_assignments", "teacher_id", { limit: 5000 })
  ]);

  const competenciesByTeacher = countRowsBy(competencies.data, "teacher_id");
  const assignmentsByTeacher = countRowsBy(assignments.data, "teacher_id");

  return {
    rows: teachers.data.map((teacher): TeacherListRow => ({
      id: teacher.id,
      legacy_id: teacher.legacy_id ?? null,
      initials: teacher.initials,
      display_name: teacher.display_name ?? null,
      skills_summary: teacher.skills_summary ?? null,
      metadata: teacher.metadata || {},
      competencies_count: competenciesByTeacher[teacher.id] || 0,
      assignments_count: assignmentsByTeacher[teacher.id] || 0
    })),
    issues: issuesFrom([teachers, competencies, assignments])
  };
}

export async function getOfferingsData() {
  const [offerings, classes, subjects, teachers, assignments, suggestions] = await Promise.all([
    readRows<Row>(
      "subject_offerings",
      "id,legacy_id,class_group_id,course_subject_id,name,total_hours,hours_missing,hours_source,priority,metadata",
      { order: "name", limit: 2000 }
    ),
    readRows<Row>("class_groups", "id,name", { limit: 1000 }),
    readRows<Row>("course_subjects", "id,name,normalized_key", { limit: 1000 }),
    readRows<Row>("teachers", "id,initials,display_name", { limit: 1000 }),
    readRows<Row>("teaching_assignments", "subject_offering_id,teacher_id,assignment_order,share_fraction", { limit: 5000 }),
    readRows<Row>("teacher_suggestions", "subject_offering_id,teacher_id,reason", { limit: 5000 })
  ]);

  const classMap = mapById(classes.data);
  const subjectMap = mapById(subjects.data);
  const teacherMap = mapById(teachers.data);
  const assignmentsByOffering = groupRows(assignments.data, "subject_offering_id");
  const suggestionsByOffering = groupRows(suggestions.data, "subject_offering_id");

  const rows = offerings.data.map((offering): OfferingRow => {
    const assignedTeachers = (assignmentsByOffering[offering.id] || [])
      .sort((a, b) => Number(a.assignment_order || 0) - Number(b.assignment_order || 0))
      .map((assignment) => teacherMap.get(assignment.teacher_id)?.initials)
      .filter(Boolean);
    const suggestedTeachers = (suggestionsByOffering[offering.id] || [])
      .map((suggestion) => teacherMap.get(suggestion.teacher_id)?.initials)
      .filter(Boolean);

    return {
      id: offering.id,
      legacy_id: offering.legacy_id,
      class_group_id: offering.class_group_id,
      course_subject_id: offering.course_subject_id,
      name: offering.name,
      total_hours: offering.total_hours ?? null,
      hours_missing: Boolean(offering.hours_missing),
      hours_source: offering.hours_source ?? null,
      priority: offering.priority,
      metadata: offering.metadata,
      class_name: classMap.get(offering.class_group_id)?.name || "-",
      subject_name: subjectMap.get(offering.course_subject_id)?.name || offering.name || "-",
      subject_key: subjectMap.get(offering.course_subject_id)?.normalized_key || "-",
      teachers: assignedTeachers,
      suggested_teachers: suggestedTeachers
    };
  });

  return { rows, issues: issuesFrom([offerings, classes, subjects, teachers, assignments, suggestions]) };
}

export async function getCalendarsData() {
  const [official, planning] = await Promise.all([
    readRows<Row>(
      "official_hf_calendar_entries",
      "id,calendar_year,date,iso_week,weekday,raw_text,course_name,course_category,teacher_initials,is_exam_or_project,is_opsamling,is_reserved_or_blocked,lock_level",
      { order: "date", limit: 1200 }
    ),
    readRows<Row>(
      "planning_calendar_events",
      "id,source_type,date,end_date,iso_week,weekday,title,event_type,lock_level,applies_to,teacher_initials,should_create_booking",
      { order: "date", limit: 1200 }
    )
  ]);

  return {
    officialByWeek: groupRows(
      official.data.map((entry) => ({
        ...entry,
        group_key: `${entry.calendar_year || "År ?"} / uge ${entry.iso_week || "?"}`
      })),
      "group_key"
    ),
    planningByWeek: groupRows(
      planning.data.map((event) => ({
        ...event,
        group_key: `uge ${event.iso_week || "?"} / ${event.event_type || "type ?"} / ${event.lock_level || "info"}`
      })),
      "group_key"
    ),
    issues: issuesFrom([official, planning])
  };
}

export async function getStaaReviewData() {
  const [classesData, offerings, subjects, activeWeeks, warnings] = await Promise.all([
    getClassesData(),
    readRows<Row>("subject_offerings", "id,class_group_id,course_subject_id,name,total_hours,hours_missing,metadata", {
      order: "name",
      limit: 2000
    }),
    readRows<Row>("course_subjects", "id,name,normalized_key", { limit: 1000 }),
    readRows<Row>("class_active_weeks", "class_group_id,week_no", { limit: 5000 }),
    readRows<Row>("import_warnings", "warning_type,severity,entity_type,entity_legacy_id,message", { limit: 2000 })
  ]);

  const subjectMap = mapById(subjects.data);
  const offeringsByClass = groupRows(offerings.data, "class_group_id");
  const weeksByClass = groupRows(activeWeeks.data, "class_group_id");

  const classes = classesData.rows.filter((klass) => {
    const name = String(klass.name || "").toLowerCase();
    const program = String(klass.program_code || "").toLowerCase();
    const category = String(klass.category_key || "").toLowerCase();
    return name.includes("studenter") || program === "staa" || category === "staa";
  });

  const rows = classes.map((klass): StaaReviewRow => {
    const weeks = (weeksByClass[klass.id] || []).map((row) => Number(row.week_no)).filter(Boolean);
    const active = weekSummary(weeks);
    const classOfferings = (offeringsByClass[klass.id] || []).map((offering): StaaReviewOfferingRow => ({
      id: offering.id,
      class_group_id: offering.class_group_id,
      course_subject_id: offering.course_subject_id,
      name: offering.name,
      total_hours: offering.total_hours ?? null,
      hours_missing: Boolean(offering.hours_missing),
      metadata: offering.metadata || {},
      subject_name: subjectMap.get(offering.course_subject_id)?.name || offering.name,
      subject_key: subjectMap.get(offering.course_subject_id)?.normalized_key || "-"
    }));
    const classWarnings = warnings.data.filter((warning) => warningMatchesClass(warning, klass));

    return {
      id: klass.id,
      legacy_id: klass.legacy_id ?? null,
      name: klass.name,
      address_label: klass.address_label,
      campus_id: klass.campus_id,
      class_category_id: klass.class_category_id,
      education_program_id: klass.education_program_id,
      planning_notes: klass.planning_notes,
      scheduling_notes: klass.scheduling_notes,
      metadata: klass.metadata || {},
      campus_name: klass.campus_name,
      category_name: klass.category_name,
      category_key: klass.category_key,
      program_name: klass.program_name,
      program_code: klass.program_code,
      subject_offerings_count: klass.subject_offerings_count,
      active_weeks_count: active.count,
      active_weeks_range: active.range,
      possible_cohort_types: klass.metadata?.possible_cohort_types || [],
      cohort_type: klass.metadata?.cohort_type || null,
      cohort_confidence: klass.metadata?.cohort_confidence || "unknown",
      combined_teaching_group_key: klass.metadata?.combined_teaching_group_key || null,
      offerings: classOfferings,
      warnings: classWarnings.map((warning) => ({
        warning_type: warning.warning_type ?? null,
        severity: warning.severity ?? null,
        message: warning.message
      })),
      warning_count: classWarnings.length
    };
  });

  return { rows, issues: [...classesData.issues, ...issuesFrom([offerings, subjects, activeWeeks, warnings])] };
}

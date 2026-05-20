import { readRows } from "./supabase";

type Row = Record<string, any>;

export type ReviewOfferingRow = {
  id: string;
  class_name: string;
  subject_name: string;
  subject_key: string;
  category_program: string;
  campus: string;
  total_hours: number | null;
  hours_missing: boolean;
  hours_source: string | null;
  priority: string | null;
  suggested_teachers: string[];
  competent_teachers: string[];
  assigned_teachers: string[];
  possible_match: string | null;
  note: string;
  severity: string;
  missing_hours_classification: "kræver timetal" | "review: container/programfag" | "foreslået match" | "manuel beslutning";
  recommended_action: string;
  suggested_hours: number | null;
  classification_reason: string;
  affects_teacher_load: boolean;
};

export type MissingCompetencyRow = {
  id: string;
  class_name: string;
  subject_name: string;
  teacher_name: string;
  teacher_initials: string;
  was_suggested: boolean;
  possible_reason: string;
  severity: string;
};

export type ImportWarningRow = {
  id: string;
  warning_type: string;
  severity: string;
  source: string;
  entity: string;
  message: string;
  source_sheet: string | null;
  source_row: number | null;
  resolved: boolean;
};

export type ImportWarningFilters = {
  warningType: string;
  severity: string;
  source: string;
  q: string;
};

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

function teacherLabel(teacher: Row | undefined) {
  if (!teacher) return null;
  return teacher.display_name ? `${teacher.initials} - ${teacher.display_name}` : teacher.initials;
}

function warningSeverity(warnings: Row[], fallback = "warning") {
  return warnings.find((warning) => warning.severity)?.severity || fallback;
}

function metadataPossibleMatch(metadata: Row | null | undefined) {
  if (!metadata) return null;
  const matches = metadata.possible_hours_matches || metadata.possible_matches || metadata.possible_match;
  if (Array.isArray(matches)) return matches.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
  if (matches && typeof matches === "object") return JSON.stringify(matches);
  return matches || metadata.hours_note || null;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "oe")
    .replaceAll("å", "aa")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractSuggestedHours(possibleMatch: string | null) {
  if (!possibleMatch) return null;
  const hourMatch = possibleMatch.match(/(?:=|:)?\s*(\d{1,3})(?:[,.]\d+)?\s*(?:timer|t\b|$)/i);
  return hourMatch ? Number(hourMatch[1]) : null;
}

function heuristicPossibleMatch(subjectName: string, subjectKey: string, className: string) {
  const subject = normalizeText(`${subjectName} ${subjectKey}`);
  const klass = normalizeText(className);

  if (klass.includes("gf2") && subject.includes("dansk") && subject.includes("c")) {
    return { possibleMatch: "GF1 Dansk C = 80", suggestedHours: 80 };
  }

  if (klass.includes("gf2") && subject.includes("engelsk") && subject.includes("c")) {
    return { possibleMatch: "GF1 Engelsk C = 80", suggestedHours: 80 };
  }

  return { possibleMatch: null, suggestedHours: null };
}

function classifyMissingHours(input: {
  subjectName: string;
  subjectKey: string;
  className: string;
  categoryProgram: string;
  possibleMatch: string | null;
}) {
  const text = normalizeText(`${input.subjectName} ${input.subjectKey}`);
  const context = normalizeText(`${input.className} ${input.categoryProgram}`);
  const containerKeys = [
    "bl_detail",
    "blandet_detail",
    "ikea_detail",
    "detail_ikea",
    "ikea_logistik",
    "handel",
    "kontor",
    "kontor_okonomi",
    "offentlig_administration",
    "off_administration",
    "administration",
    "logistik"
  ];
  const exactContainerMatch = containerKeys.some((key) => text === key || text.includes(key));
  const likelyContainer =
    exactContainerMatch ||
    (["handel", "kontor", "logistik", "administration"].includes(text) && context.includes("hovedforloeb"));

  if (likelyContainer) {
    return {
      missing_hours_classification: "review: container/programfag" as const,
      recommended_action: "Afklar om posten kun er container/programfag. Hvis ja, skal den ikke have skematimer direkte.",
      suggested_hours: null,
      classification_reason: "Navnet matcher et forløb/program eller en hovedforløbskategori frem for et konkret undervisningsfag.",
      affects_teacher_load: false,
      possible_match: input.possibleMatch
    };
  }

  const heuristicMatch = heuristicPossibleMatch(input.subjectName, input.subjectKey, input.className);
  const possibleMatch = input.possibleMatch || heuristicMatch.possibleMatch;
  const suggestedHours = extractSuggestedHours(possibleMatch) ?? heuristicMatch.suggestedHours;

  if (possibleMatch) {
    return {
      missing_hours_classification: "foreslået match" as const,
      recommended_action: "Vurder match og udfyld timetal, hvis det er korrekt.",
      suggested_hours: suggestedHours,
      classification_reason: "Der findes et muligt timematch i importmetadata eller via konservativ GF1/GF2-heuristik.",
      affects_teacher_load: true,
      possible_match: possibleMatch
    };
  }

  const realSubjectPatterns = [
    "arbejdsmarkedsparathed",
    "erhvervsinformatik",
    "dansk",
    "engelsk",
    "matematik",
    "samfundsfag",
    "naturfag",
    "teknologi",
    "afsætning",
    "virksomhedsoekonomi",
    "informationsteknologi"
  ];
  const levelPattern = /(^|_)(a|b|c|d|e|f)(_|$)/;
  const likelyRealSubject = realSubjectPatterns.some((pattern) => text.includes(normalizeText(pattern))) || levelPattern.test(text);

  if (likelyRealSubject) {
    return {
      missing_hours_classification: "kræver timetal" as const,
      recommended_action: "Find korrekt timetal i opgave-/faggrundlaget og udfyld det senere.",
      suggested_hours: null,
      classification_reason: "Posten ligner et konkret undervisningsfag, som normalt påvirker fagfordeling og lærerbelastning.",
      affects_teacher_load: true,
      possible_match: input.possibleMatch
    };
  }

  return {
    missing_hours_classification: "manuel beslutning" as const,
    recommended_action: "Afgør manuelt om posten er skemabærende fag eller kun planlægningscontainer.",
    suggested_hours: null,
    classification_reason: "Der er ikke nok sikre signaler til at klassificere posten automatisk.",
    affects_teacher_load: true,
    possible_match: input.possibleMatch
  };
}

function warningTextForOffering(warnings: Row[], offering: Row, warningTypes: string[]) {
  const haystack = `${offering.legacy_id || ""} ${offering.name || ""}`.toLowerCase();
  return warnings.filter((warning) => {
    const typeMatch = warningTypes.includes(warning.warning_type);
    const warningTarget = `${warning.entity_legacy_id || ""} ${warning.message || ""}`.toLowerCase();
    return typeMatch && (!haystack.trim() || warningTarget.includes(haystack) || haystack.includes(warningTarget));
  });
}

async function getReviewBaseData() {
  const [offerings, classes, subjects, campuses, categories, programs, assignments, suggestions, teachers, competencies, warnings, imports] =
    await Promise.all([
      readRows<Row>(
        "subject_offerings",
        "id,legacy_id,class_group_id,course_subject_id,name,total_hours,hours_missing,hours_source,priority,metadata",
        { order: "name", limit: 5000 }
      ),
      readRows<Row>("class_groups", "id,legacy_id,name,address_label,campus_id,class_category_id,education_program_id,metadata", {
        order: "name",
        limit: 2000
      }),
      readRows<Row>("course_subjects", "id,name,normalized_key", { order: "name", limit: 2000 }),
      readRows<Row>("campuses", "id,name,legacy_label", { order: "name", limit: 500 }),
      readRows<Row>("class_categories", "id,name,normalized_key", { order: "name", limit: 500 }),
      readRows<Row>("education_programs", "id,code,name", { order: "code", limit: 500 }),
      readRows<Row>("teaching_assignments", "id,subject_offering_id,teacher_id", { limit: 10000 }),
      readRows<Row>("teacher_suggestions", "subject_offering_id,teacher_id,reason", { limit: 10000 }),
      readRows<Row>("teachers", "id,initials,display_name", { order: "initials", limit: 2000 }),
      readRows<Row>("teacher_competencies", "teacher_id,course_subject_id,level", { limit: 10000 }),
      readRows<Row>(
        "import_warnings",
        "id,data_import_id,warning_type,severity,source_sheet,source_row,entity_type,entity_legacy_id,message,resolved,created_at",
        { order: "created_at", ascending: false, limit: 10000 }
      ),
      readRows<Row>("data_imports", "id,source_kind,source_name,import_version,imported_at", {
        order: "imported_at",
        ascending: false,
        limit: 1000
      })
    ]);

  const classMap = mapById(classes.data);
  const subjectMap = mapById(subjects.data);
  const campusMap = mapById(campuses.data);
  const categoryMap = mapById(categories.data);
  const programMap = mapById(programs.data);
  const teacherMap = mapById(teachers.data);
  const importMap = mapById(imports.data);
  const assignmentsByOffering = groupRows(assignments.data, "subject_offering_id");
  const suggestionsByOffering = groupRows(suggestions.data, "subject_offering_id");

  const competencyKeys = new Set(competencies.data.map((row) => `${row.teacher_id}:${row.course_subject_id}`));
  const competentTeachersBySubject = competencies.data.reduce<Record<string, string[]>>((acc, competency) => {
    const label = teacherLabel(teacherMap.get(competency.teacher_id));
    if (!label) return acc;
    acc[competency.course_subject_id] = acc[competency.course_subject_id] || [];
    if (!acc[competency.course_subject_id].includes(label)) acc[competency.course_subject_id].push(label);
    return acc;
  }, {});

  const enrichedOfferings = offerings.data.map((offering): ReviewOfferingRow & { assignment_count: number } => {
    const klass = classMap.get(offering.class_group_id);
    const subject = subjectMap.get(offering.course_subject_id);
    const category = categoryMap.get(klass?.class_category_id);
    const program = programMap.get(klass?.education_program_id);
    const campus = campusMap.get(klass?.campus_id);
    const offeringWarnings = warningTextForOffering(warnings.data, offering, [
      "subject_missing_hours",
      "missing_hours",
      "subject_missing_teacher_assignment",
      "missing_assignment"
    ]);
    const subjectName = subject?.name || offering.name || "-";
    const subjectKey = subject?.normalized_key || "-";
    const className = klass?.name || "-";
    const categoryProgram = `${category?.name || klass?.metadata?.possible_category || "-"} / ${program?.name || klass?.metadata?.common_education_program_code || "-"}`;
    const possibleMatch = metadataPossibleMatch(offering.metadata);
    const missingHoursReview = classifyMissingHours({
      subjectName,
      subjectKey,
      className,
      categoryProgram,
      possibleMatch
    });

    return {
      id: offering.id,
      class_name: className,
      subject_name: subjectName,
      subject_key: subjectKey,
      category_program: categoryProgram,
      campus: campus?.name || klass?.address_label || "-",
      total_hours: offering.total_hours === null || offering.total_hours === undefined ? null : Number(offering.total_hours),
      hours_missing: Boolean(offering.hours_missing),
      hours_source: offering.hours_source ?? null,
      priority: offering.priority ?? null,
      suggested_teachers: (suggestionsByOffering[offering.id] || [])
        .map((suggestion) => teacherLabel(teacherMap.get(suggestion.teacher_id)))
        .filter(Boolean) as string[],
      competent_teachers: competentTeachersBySubject[offering.course_subject_id] || [],
      assigned_teachers: (assignmentsByOffering[offering.id] || [])
        .map((assignment) => teacherLabel(teacherMap.get(assignment.teacher_id)))
        .filter(Boolean) as string[],
      possible_match: missingHoursReview.possible_match,
      note: offeringWarnings[0]?.message || "Skal rettes i næste fase.",
      severity: warningSeverity(offeringWarnings),
      missing_hours_classification: missingHoursReview.missing_hours_classification,
      recommended_action: missingHoursReview.recommended_action,
      suggested_hours: missingHoursReview.suggested_hours,
      classification_reason: missingHoursReview.classification_reason,
      affects_teacher_load: missingHoursReview.affects_teacher_load,
      assignment_count: (assignmentsByOffering[offering.id] || []).length
    };
  });

  const missingCompetencies = assignments.data
    .filter((assignment) => {
      const offering = offerings.data.find((item) => item.id === assignment.subject_offering_id);
      return offering && !competencyKeys.has(`${assignment.teacher_id}:${offering.course_subject_id}`);
    })
    .map((assignment): MissingCompetencyRow => {
      const offering = offerings.data.find((item) => item.id === assignment.subject_offering_id)!;
      const klass = classMap.get(offering.class_group_id);
      const subject = subjectMap.get(offering.course_subject_id);
      const teacher = teacherMap.get(assignment.teacher_id);
      const suggestionsForOffering = suggestionsByOffering[offering.id] || [];
      const warning = warnings.data.find(
        (item) =>
          item.warning_type === "teacher_missing_competency" &&
          String(item.message || "").includes(teacher?.initials || "") &&
          String(item.message || "").toLowerCase().includes(String(subject?.name || offering.name || "").toLowerCase())
      );

      return {
        id: assignment.id,
        class_name: klass?.name || "-",
        subject_name: subject?.name || offering.name || "-",
        teacher_name: teacher?.display_name || "-",
        teacher_initials: teacher?.initials || "-",
        was_suggested: suggestionsForOffering.some((suggestion) => suggestion.teacher_id === assignment.teacher_id),
        possible_reason: warning?.message || "Læreren er fagfordelt, men der er ikke registreret kompetence til faget.",
        severity: warning?.severity || "warning"
      };
    });

  const importWarnings = warnings.data.map((warning): ImportWarningRow => {
    const sourceImport = importMap.get(warning.data_import_id);
    return {
      id: warning.id,
      warning_type: warning.warning_type || "ukendt",
      severity: warning.severity || "warning",
      source: sourceImport?.source_name || sourceImport?.source_kind || warning.source_sheet || "-",
      entity: [warning.entity_type, warning.entity_legacy_id].filter(Boolean).join(": ") || "-",
      message: warning.message || "-",
      source_sheet: warning.source_sheet || null,
      source_row: warning.source_row || null,
      resolved: Boolean(warning.resolved)
    };
  });

  const staaReviewCount = classes.data.filter((klass) => {
    const program = programMap.get(klass.education_program_id);
    return (
      program?.code === "staa" ||
      String(klass.name || "").toLowerCase().includes("studenter") ||
      Array.isArray(klass.metadata?.possible_cohort_types)
    );
  }).length;

  return {
    enrichedOfferings,
    missingCompetencies,
    importWarnings,
    staaReviewCount,
    issues: issuesFrom([
      offerings,
      classes,
      subjects,
      campuses,
      categories,
      programs,
      assignments,
      suggestions,
      teachers,
      competencies,
      warnings,
      imports
    ])
  };
}

export async function getReviewSummaryData() {
  const base = await getReviewBaseData();
  const missingHours = base.enrichedOfferings.filter((row) => row.hours_missing || !row.total_hours || row.total_hours <= 0);
  const missingAssignments = base.enrichedOfferings.filter((row) => row.assignment_count === 0);

  return {
    cards: [
      { label: "Importwarnings total", value: base.importWarnings.length, href: "/review/importwarnings" },
      { label: "Manglende timetal", value: missingHours.length, href: "/review/manglende-timer" },
      { label: "Manglende fagfordeling", value: missingAssignments.length, href: "/review/manglende-fagfordeling" },
      { label: "Fagfordelinger uden kompetence", value: base.missingCompetencies.length, href: "/review/manglende-kompetencer" },
      {
        label: "Usikre holdkategorier",
        value: base.importWarnings.filter((warning) => warning.warning_type === "class_category_uncertain").length,
        href: "/review/importwarnings?warningType=class_category_uncertain"
      },
      {
        label: "STÅ-kohorte til review",
        value: Math.max(
          base.staaReviewCount,
          base.importWarnings.filter((warning) => warning.warning_type === "class_cohort_uncertain").length
        ),
        href: "/review/staa"
      },
      {
        label: "HF-kalender warnings",
        value: base.importWarnings.filter((warning) => `${warning.warning_type} ${warning.source}`.toLowerCase().includes("hf")).length,
        href: "/review/importwarnings?q=hf"
      }
    ],
    issues: base.issues
  };
}

export async function getMissingHoursReviewData() {
  const base = await getReviewBaseData();
  return {
    rows: base.enrichedOfferings.filter((row) => row.hours_missing || !row.total_hours || row.total_hours <= 0),
    issues: base.issues
  };
}

export async function getMissingAssignmentsReviewData() {
  const base = await getReviewBaseData();
  return {
    rows: base.enrichedOfferings.filter((row) => row.assignment_count === 0),
    issues: base.issues
  };
}

export async function getMissingCompetenciesReviewData() {
  const base = await getReviewBaseData();
  return {
    rows: base.missingCompetencies,
    issues: base.issues
  };
}

export function parseImportWarningFilters(params: Record<string, string | string[] | undefined>): ImportWarningFilters {
  const value = (key: string) => {
    const raw = params[key];
    return Array.isArray(raw) ? raw[0] || "" : raw || "";
  };

  return {
    warningType: value("warningType"),
    severity: value("severity"),
    source: value("source"),
    q: value("q")
  };
}

export async function getImportWarningsReviewData(filters: ImportWarningFilters) {
  const base = await getReviewBaseData();
  const q = filters.q.toLowerCase();

  const rows = base.importWarnings.filter((warning) => {
    if (filters.warningType && warning.warning_type !== filters.warningType) return false;
    if (filters.severity && warning.severity !== filters.severity) return false;
    if (filters.source && warning.source !== filters.source) return false;
    if (q && !`${warning.warning_type} ${warning.source} ${warning.entity} ${warning.message}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return {
    rows,
    warningTypes: [...new Set(base.importWarnings.map((warning) => warning.warning_type))].sort(),
    severities: [...new Set(base.importWarnings.map((warning) => warning.severity))].sort(),
    sources: [...new Set(base.importWarnings.map((warning) => warning.source))].sort(),
    issues: base.issues
  };
}

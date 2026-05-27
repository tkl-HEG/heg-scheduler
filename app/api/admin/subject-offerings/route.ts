import { NextRequest, NextResponse } from "next/server";
import { assertAdminOrEditor, getAdminIdentityForAudit, getRequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "create" | "update" | "deactivate" | "reactivate";
type PeriodUnit = "weeks" | "days";
type SubjectPriority = "high" | "medium" | "low";
type RequestBody = {
  action?: unknown;
  id?: unknown;
  school_id?: unknown;
  course_subject_id?: unknown;
  class_group_ids?: unknown;
  total_hours?: unknown;
  hours_missing?: unknown;
  hours_source?: unknown;
  period_value?: unknown;
  period_unit?: unknown;
  start_week?: unknown;
  priority?: unknown;
  sort_order?: unknown;
  allow_requirement_mismatch?: unknown;
  archived_reason?: unknown;
};
type SchoolRow = {
  id: string;
  organization_id: string;
};
type CourseSubjectRow = {
  id: string;
  school_id: string;
  name: string;
  normalized_key: string | null;
};
type ClassGroupRow = {
  id: string;
  school_id: string;
  name: string;
};
type SubjectOfferingRow = {
  id: string;
  school_id: string;
  legacy_id: string | null;
  class_group_id: string;
  course_subject_id: string;
  pairing_group_id: string | null;
  name: string;
  total_hours: number | string;
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
};
type SubjectOfferingMembershipRow = {
  subject_offering_id: string;
  class_group_id: string;
  school_id: string;
  member_role: "primary" | "secondary" | "shared" | "observer";
  sort_order: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type OfferingInput = {
  course_subject_id: string;
  class_group_ids: string[];
  total_hours: number;
  hours_missing: boolean;
  hours_source: string | null;
  period_value: number;
  period_unit: PeriodUnit;
  start_week: number;
  priority: SubjectPriority;
  sort_order: number | null;
  allow_requirement_mismatch: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const OFFERING_SELECT =
  "id,school_id,legacy_id,class_group_id,course_subject_id,pairing_group_id,name,total_hours,hours_missing,hours_source,period_value,period_unit,start_week,priority,sort_order,metadata,is_active,archived_at,archived_by,archived_reason,created_at,updated_at";
const MEMBERSHIP_SELECT =
  "subject_offering_id,class_group_id,school_id,member_role,sort_order,metadata,created_at,updated_at";
const PERIOD_UNITS = new Set<PeriodUnit>(["weeks", "days"]);
const PRIORITIES = new Set<SubjectPriority>(["high", "medium", "low"]);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is RequestBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUuid(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function parseAction(value: unknown, fallback: Action): Action | null {
  if (value === undefined || value === null || value === "") return fallback;
  return value === "create" || value === "update" || value === "deactivate" || value === "reactivate" ? value : null;
}

function parseBoolean(value: unknown, fieldName: string) {
  if (typeof value === "boolean") return { value, error: null };
  if (value === "true") return { value: true, error: null };
  if (value === "false") return { value: false, error: null };
  return { value: null, error: `${fieldName} skal være true eller false.` };
}

function parseOptionalBoolean(value: unknown, fieldName: string, fallback = false) {
  if (value === undefined || value === null || value === "") return { value: fallback, error: null };
  return parseBoolean(value, fieldName);
}

function parseNumber(value: unknown, fieldName: string, max = 99999.99) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    return { value: null, error: `${fieldName} skal være et tal mellem 0 og ${max}.` };
  }

  return { value: Math.round(parsed * 100) / 100, error: null };
}

function parseRequiredInteger(value: unknown, fieldName: string, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: null, error: `${fieldName} skal være et heltal mellem ${min} og ${max}.` };
  }

  return { value: parsed, error: null };
}

function parseOptionalInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isInteger(parsed) || parsed < -999999 || parsed > 999999) {
    return { value: null, error: `${fieldName} skal være et heltal eller tom.` };
  }

  return { value: parsed, error: null };
}

function parseOptionalText(value: unknown, fieldName: string, maxLength = 240) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };
  if (typeof value !== "string") return { value: null, error: `${fieldName} skal være tekst eller tom.` };

  const trimmed = value.trim();

  if (!trimmed) return { value: null, error: null };
  if (trimmed.length > maxLength) return { value: null, error: `${fieldName} må højst være ${maxLength} tegn.` };
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return { value: null, error: `${fieldName} må ikke indeholde kontroltegn.` };

  return { value: trimmed, error: null };
}

function parseArchivedReason(value: unknown) {
  if (value === undefined || value === null || value === "") return "Admin deactivation from /admin/fagudbud";
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (!trimmed) return "Admin deactivation from /admin/fagudbud";
  if (trimmed.length > 240) return null;
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return null;

  return trimmed;
}

function parseEnum<T extends string>(value: unknown, values: Set<T>, fieldName: string, fallback: T) {
  if (value === undefined || value === null || value === "") return { value: fallback, error: null };
  return typeof value === "string" && values.has(value as T)
    ? { value: value as T, error: null }
    : { value: null, error: `${fieldName} har en ugyldig værdi.` };
}

function parseClassGroupIds(value: unknown) {
  if (!Array.isArray(value)) {
    return { value: null, error: "class_group_ids skal være en liste af uuid'er." };
  }

  const classGroupIds: string[] = [];

  for (const item of value) {
    const classGroupId = normalizeUuid(item);

    if (!classGroupId) {
      return { value: null, error: "Alle class_group_ids skal være gyldige uuid'er." };
    }

    if (!classGroupIds.includes(classGroupId)) {
      classGroupIds.push(classGroupId);
    }
  }

  if (!classGroupIds.length) {
    return { value: null, error: "Vælg mindst ét hold til fagudbuddet." };
  }

  if (classGroupIds.length > 50) {
    return { value: null, error: "Der kan højst vælges 50 hold til ét fagudbud." };
  }

  return { value: classGroupIds, error: null };
}

function parseOfferingInput(rawBody: RequestBody): { value: OfferingInput | null; error: string | null } {
  const courseSubjectId = normalizeUuid(rawBody.course_subject_id);
  const classGroupIds = parseClassGroupIds(rawBody.class_group_ids);
  const totalHours = parseNumber(rawBody.total_hours, "total_hours");
  const hoursMissing = parseBoolean(rawBody.hours_missing, "hours_missing");
  const hoursSource = parseOptionalText(rawBody.hours_source, "hours_source", 240);
  const periodValue = parseRequiredInteger(rawBody.period_value, "period_value", 1, 500);
  const periodUnit = parseEnum(rawBody.period_unit, PERIOD_UNITS, "period_unit", "weeks");
  const startWeek = parseRequiredInteger(rawBody.start_week, "start_week", 1, 80);
  const priority = parseEnum(rawBody.priority, PRIORITIES, "priority", "medium");
  const sortOrder = parseOptionalInteger(rawBody.sort_order, "sort_order");
  const allowRequirementMismatch = parseOptionalBoolean(rawBody.allow_requirement_mismatch, "allow_requirement_mismatch");
  const firstError =
    (!courseSubjectId ? "course_subject_id skal være en gyldig uuid." : null) ||
    classGroupIds.error ||
    totalHours.error ||
    hoursMissing.error ||
    hoursSource.error ||
    periodValue.error ||
    periodUnit.error ||
    startWeek.error ||
    priority.error ||
    sortOrder.error ||
    allowRequirementMismatch.error;

  if (
    firstError ||
    !courseSubjectId ||
    !classGroupIds.value ||
    totalHours.value === null ||
    hoursMissing.value === null ||
    periodValue.value === null ||
    !periodUnit.value ||
    startWeek.value === null ||
    !priority.value ||
    allowRequirementMismatch.value === null
  ) {
    return { value: null, error: firstError || "Fagudbudsinput er ugyldigt." };
  }

  return {
    value: {
      course_subject_id: courseSubjectId,
      class_group_ids: classGroupIds.value,
      total_hours: totalHours.value,
      hours_missing: hoursMissing.value,
      hours_source: hoursSource.value,
      period_value: periodValue.value,
      period_unit: periodUnit.value,
      start_week: startWeek.value,
      priority: priority.value,
      sort_order: sortOrder.value,
      allow_requirement_mismatch: allowRequirementMismatch.value
    },
    error: null
  };
}

function metadataForOfferingChange(existing: Record<string, unknown> | null | undefined, action: Action) {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    last_admin_update: {
      route: "/api/admin/subject-offerings",
      action,
      source: "admin_subject_offerings_ui"
    }
  };
}

function metadataForMembershipChange(existing: Record<string, unknown> | null | undefined, action: "insert" | "update") {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    last_admin_update: {
      route: "/api/admin/subject-offerings",
      action,
      source: "admin_subject_offerings_ui"
    }
  };
}

function sameNumber(left: unknown, right: number | null) {
  const leftNumber = typeof left === "number" ? left : typeof left === "string" ? Number(left) : null;
  return (Number.isFinite(leftNumber) ? Number(leftNumber) : null) === right;
}

function sameNullableText(left: string | null | undefined, right: string | null) {
  return (left || null) === (right || null);
}

function hasOfferingChanges(existing: SubjectOfferingRow, input: OfferingInput, subjectName: string) {
  return (
    existing.course_subject_id !== input.course_subject_id ||
    existing.class_group_id !== input.class_group_ids[0] ||
    existing.name !== subjectName ||
    !sameNumber(existing.total_hours, input.total_hours) ||
    Boolean(existing.hours_missing) !== input.hours_missing ||
    !sameNullableText(existing.hours_source, input.hours_source) ||
    Number(existing.period_value) !== input.period_value ||
    existing.period_unit !== input.period_unit ||
    Number(existing.start_week) !== input.start_week ||
    existing.priority !== input.priority ||
    !sameNumber(existing.sort_order, input.sort_order)
  );
}

function sameClassGroupOrder(existing: SubjectOfferingMembershipRow[], classGroupIds: string[]) {
  const existingIds = [...existing]
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))
    .map((membership) => membership.class_group_id);

  return existingIds.length === classGroupIds.length && existingIds.every((id, index) => id === classGroupIds[index]);
}

async function writeOfferingAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string;
    changeType: "insert" | "update";
    beforeData: SubjectOfferingRow | null;
    afterData: SubjectOfferingRow;
    changedBy: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "subject_offerings",
    record_id: input.recordId,
    change_type: input.changeType,
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/subject-offerings",
      school_id: input.afterData.school_id,
      course_subject_id: input.afterData.course_subject_id,
      primary_class_group_id: input.afterData.class_group_id,
      is_active: input.afterData.is_active
    }
  });
}

async function writeMembershipAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string;
    changeType: "insert" | "update" | "delete";
    beforeData: SubjectOfferingMembershipRow | null;
    afterData: SubjectOfferingMembershipRow | null;
    changedBy: string;
    classGroupId: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "subject_offering_class_groups",
    record_id: input.recordId,
    change_type: input.changeType,
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/subject-offerings",
      subject_offering_id: input.recordId,
      class_group_id: input.classGroupId
    }
  });
}

async function getSchool(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  schoolId: string
) {
  return client.from("schools").select("id,organization_id").eq("id", schoolId).maybeSingle<SchoolRow>();
}

async function getSubjectOffering(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  id: string
) {
  return client.from("subject_offerings").select(OFFERING_SELECT).eq("id", id).maybeSingle<SubjectOfferingRow>();
}

async function getMemberships(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  subjectOfferingId: string
) {
  return client
    .from("subject_offering_class_groups")
    .select(MEMBERSHIP_SELECT)
    .eq("subject_offering_id", subjectOfferingId)
    .order("sort_order", { ascending: true });
}

async function validateCourseSubject(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  courseSubjectId: string,
  schoolId: string
) {
  const subject = await client
    .from("course_subjects")
    .select("id,school_id,name,normalized_key")
    .eq("id", courseSubjectId)
    .maybeSingle<CourseSubjectRow>();

  if (subject.error) return { data: null, error: `course_subjects: ${subject.error.message}` };
  if (!subject.data) return { data: null, error: "Fag blev ikke fundet." };
  if (subject.data.school_id !== schoolId) return { data: null, error: "Faget hører ikke til samme skole." };

  return { data: subject.data, error: null };
}

async function validateClassGroups(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  classGroupIds: string[],
  schoolId: string
) {
  const classGroups = await client
    .from("class_groups")
    .select("id,school_id,name")
    .in("id", classGroupIds)
    .returns<ClassGroupRow[]>();

  if (classGroups.error) return { data: null, error: `class_groups: ${classGroups.error.message}` };

  const found = classGroups.data || [];
  const foundIds = new Set(found.map((classGroup) => classGroup.id));
  const missing = classGroupIds.filter((classGroupId) => !foundIds.has(classGroupId));

  if (missing.length) {
    return { data: null, error: "Et eller flere valgte hold blev ikke fundet." };
  }

  if (found.some((classGroup) => classGroup.school_id !== schoolId)) {
    return { data: null, error: "Alle valgte hold skal høre til samme skole som fagudbuddet." };
  }

  return { data: found, error: null };
}

async function findDuplicateClassSubjects(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    schoolId: string;
    courseSubjectId: string;
    classGroupIds: string[];
    classGroups: ClassGroupRow[];
    excludeSubjectOfferingId?: string | null;
  }
) {
  const membershipRows = await client
    .from("subject_offering_class_groups")
    .select("subject_offering_id,class_group_id")
    .eq("school_id", input.schoolId)
    .in("class_group_id", input.classGroupIds);

  if (membershipRows.error) {
    return { duplicates: [], error: `subject_offering_class_groups duplicate check: ${membershipRows.error.message}` };
  }

  const membershipOfferingIds = [
    ...new Set((membershipRows.data || []).map((membership) => membership.subject_offering_id).filter(Boolean) as string[])
  ];
  const offeringMatchesByClassGroup = new Map<string, string[]>();
  const classGroupNameById = new Map(input.classGroups.map((classGroup) => [classGroup.id, classGroup.name]));

  if (membershipOfferingIds.length) {
    let memberOfferingsQuery = client
      .from("subject_offerings")
      .select("id,course_subject_id,is_active")
      .in("id", membershipOfferingIds)
      .eq("course_subject_id", input.courseSubjectId)
      .eq("is_active", true);

    if (input.excludeSubjectOfferingId) {
      memberOfferingsQuery = memberOfferingsQuery.neq("id", input.excludeSubjectOfferingId);
    }

    const memberOfferings = await memberOfferingsQuery;

    if (memberOfferings.error) {
      return { duplicates: [], error: `subject_offerings member duplicate check: ${memberOfferings.error.message}` };
    }

    const matchingOfferingIds = new Set((memberOfferings.data || []).map((offering) => offering.id));

    for (const membership of membershipRows.data || []) {
      if (!matchingOfferingIds.has(membership.subject_offering_id)) continue;

      const existing = offeringMatchesByClassGroup.get(membership.class_group_id) || [];
      existing.push(membership.subject_offering_id);
      offeringMatchesByClassGroup.set(membership.class_group_id, existing);
    }
  }

  let legacyQuery = client
    .from("subject_offerings")
    .select("id,class_group_id,course_subject_id,is_active")
    .eq("school_id", input.schoolId)
    .eq("course_subject_id", input.courseSubjectId)
    .eq("is_active", true)
    .in("class_group_id", input.classGroupIds);

  if (input.excludeSubjectOfferingId) {
    legacyQuery = legacyQuery.neq("id", input.excludeSubjectOfferingId);
  }

  const legacyMatches = await legacyQuery;

  if (legacyMatches.error) {
    return { duplicates: [], error: `subject_offerings legacy duplicate check: ${legacyMatches.error.message}` };
  }

  for (const offering of legacyMatches.data || []) {
    const existing = offeringMatchesByClassGroup.get(offering.class_group_id) || [];
    existing.push(offering.id);
    offeringMatchesByClassGroup.set(offering.class_group_id, existing);
  }

  return {
    duplicates: [...offeringMatchesByClassGroup.entries()].map(([classGroupId, subjectOfferingIds]) => ({
      class_group_id: classGroupId,
      class_group_name: classGroupNameById.get(classGroupId) || classGroupId,
      subject_offering_ids: [...new Set(subjectOfferingIds)]
    })),
    error: null
  };
}

async function findRequirementMismatches(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    schoolId: string;
    courseSubjectId: string;
    classGroupIds: string[];
    classGroups: ClassGroupRow[];
  }
) {
  const requirements = await client
    .from("v_requirement_status")
    .select("class_group_id,course_subject_id")
    .eq("school_id", input.schoolId)
    .eq("course_subject_id", input.courseSubjectId)
    .in("class_group_id", input.classGroupIds);

  if (requirements.error) {
    return { mismatches: [], error: `v_requirement_status: ${requirements.error.message}` };
  }

  const requiredClassGroupIds = new Set((requirements.data || []).map((requirement) => requirement.class_group_id));
  const classGroupNameById = new Map(input.classGroups.map((classGroup) => [classGroup.id, classGroup.name]));

  return {
    mismatches: input.classGroupIds
      .filter((classGroupId) => !requiredClassGroupIds.has(classGroupId))
      .map((classGroupId) => ({
        class_group_id: classGroupId,
        class_group_name: classGroupNameById.get(classGroupId) || classGroupId
      })),
    error: null
  };
}

async function getAuthedRequestContext(request: NextRequest) {
  const config = getServerSupabaseConfig();
  const client = createServerSupabaseAdminClient();

  if (!client) {
    return {
      client: null,
      userResult: null,
      response: json(500, { success: false, error: config.issue || "Supabase server client mangler konfiguration." })
    };
  }

  const userResult = await getRequestUser(request, client);

  if ("error" in userResult) {
    return {
      client,
      userResult: null,
      response: json(userResult.status, { success: false, error: userResult.error })
    };
  }

  return { client, userResult, response: null };
}

async function parseJsonBody(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!isRecord(body)) {
      return { body: null, response: json(400, { success: false, error: "Request body skal være et JSON object." }) };
    }

    return { body, response: null };
  } catch {
    return { body: null, response: json(400, { success: false, error: "Request body skal være JSON." }) };
  }
}

function membershipPayload(input: {
  subjectOfferingId: string;
  schoolId: string;
  classGroupId: string;
  index: number;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    subject_offering_id: input.subjectOfferingId,
    class_group_id: input.classGroupId,
    school_id: input.schoolId,
    member_role: input.index === 0 ? "primary" : "shared",
    sort_order: input.index + 1,
    metadata: metadataForMembershipChange(input.metadata, input.metadata ? "update" : "insert")
  };
}

async function syncMemberships(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    subjectOfferingId: string;
    schoolId: string;
    classGroupIds: string[];
    existing: SubjectOfferingMembershipRow[];
    changedBy: string;
  }
) {
  const existingByClassGroup = new Map(input.existing.map((membership) => [membership.class_group_id, membership]));
  const desiredClassGroupIds = new Set(input.classGroupIds);

  for (const existingMembership of input.existing) {
    if (desiredClassGroupIds.has(existingMembership.class_group_id)) continue;

    const removed = await client
      .from("subject_offering_class_groups")
      .delete()
      .eq("subject_offering_id", input.subjectOfferingId)
      .eq("class_group_id", existingMembership.class_group_id);

    if (removed.error) {
      return { error: `subject_offering_class_groups delete: ${removed.error.message}` };
    }

    const audit = await writeMembershipAudit(client, {
      recordId: input.subjectOfferingId,
      changeType: "delete",
      beforeData: existingMembership,
      afterData: null,
      changedBy: input.changedBy,
      classGroupId: existingMembership.class_group_id
    });

    if (audit.error) {
      return { error: `data_change_log insert: ${audit.error.message}` };
    }
  }

  for (const [index, classGroupId] of input.classGroupIds.entries()) {
    const existingMembership = existingByClassGroup.get(classGroupId);
    const payload = membershipPayload({
      subjectOfferingId: input.subjectOfferingId,
      schoolId: input.schoolId,
      classGroupId,
      index,
      metadata: existingMembership?.metadata
    });

    if (!existingMembership) {
      const inserted = await client
        .from("subject_offering_class_groups")
        .insert(payload)
        .select(MEMBERSHIP_SELECT)
        .single<SubjectOfferingMembershipRow>();

      if (inserted.error) {
        return { error: `subject_offering_class_groups insert: ${inserted.error.message}` };
      }

      const audit = await writeMembershipAudit(client, {
        recordId: input.subjectOfferingId,
        changeType: "insert",
        beforeData: null,
        afterData: inserted.data,
        changedBy: input.changedBy,
        classGroupId
      });

      if (audit.error) {
        return { error: `data_change_log insert: ${audit.error.message}` };
      }

      continue;
    }

    const roleChanged = existingMembership.member_role !== payload.member_role;
    const sortChanged = (existingMembership.sort_order ?? null) !== payload.sort_order;

    if (!roleChanged && !sortChanged) continue;

    const saved = await client
      .from("subject_offering_class_groups")
      .update({
        member_role: payload.member_role,
        sort_order: payload.sort_order,
        metadata: payload.metadata
      })
      .eq("subject_offering_id", input.subjectOfferingId)
      .eq("class_group_id", classGroupId)
      .select(MEMBERSHIP_SELECT)
      .single<SubjectOfferingMembershipRow>();

    if (saved.error) {
      return { error: `subject_offering_class_groups update: ${saved.error.message}` };
    }

    const audit = await writeMembershipAudit(client, {
      recordId: input.subjectOfferingId,
      changeType: "update",
      beforeData: existingMembership,
      afterData: saved.data,
      changedBy: input.changedBy,
      classGroupId
    });

    if (audit.error) {
      return { error: `data_change_log insert: ${audit.error.message}` };
    }
  }

  return { error: null };
}

function apiOfferingResponse(
  status: number,
  input: { apiStatus: string; offering: SubjectOfferingRow; memberships: SubjectOfferingMembershipRow[] }
) {
  const sortedMemberships = [...input.memberships].sort(
    (a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.class_group_id.localeCompare(b.class_group_id)
  );

  return json(status, {
    success: true,
    status: input.apiStatus,
    offering: input.offering,
    memberships: sortedMemberships,
    class_group_ids: sortedMemberships.map((membership) => membership.class_group_id)
  });
}

export async function POST(request: NextRequest) {
  const context = await getAuthedRequestContext(request);

  if (context.response) return context.response;

  const parsed = await parseJsonBody(request);

  if (parsed.response) return parsed.response;

  const client = context.client!;
  const rawBody = parsed.body!;
  const action = parseAction(rawBody.action, "create");

  if (action !== "create") {
    return json(400, { success: false, error: 'POST understøtter kun action "create".' });
  }

  const schoolId = normalizeUuid(rawBody.school_id);

  if (!schoolId) {
    return json(400, { success: false, error: "school_id skal være en gyldig uuid." });
  }

  const input = parseOfferingInput(rawBody);

  if (input.error || !input.value) {
    return json(400, { success: false, error: input.error || "Fagudbudsinput er ugyldigt." });
  }

  const school = await getSchool(client, schoolId);

  if (school.error) {
    return json(500, { success: false, error: `schools: ${school.error.message}` });
  }

  if (!school.data) {
    return json(404, { success: false, error: "Skole blev ikke fundet." });
  }

  const adminAuth = await assertAdminOrEditor({
    request,
    organizationId: school.data.organization_id,
    client,
    user: context.userResult!.user
  });

  if ("error" in adminAuth) {
    return json(adminAuth.status, { success: false, error: adminAuth.error });
  }

  const subject = await validateCourseSubject(client, input.value.course_subject_id, schoolId);

  if (subject.error || !subject.data) {
    return json(subject.error?.startsWith("course_subjects:") ? 500 : 400, { success: false, error: subject.error || "Fag er ugyldigt." });
  }

  const classGroups = await validateClassGroups(client, input.value.class_group_ids, schoolId);

  if (classGroups.error) {
    return json(classGroups.error.startsWith("class_groups:") ? 500 : 400, { success: false, error: classGroups.error });
  }

  const duplicates = await findDuplicateClassSubjects(client, {
    schoolId,
    courseSubjectId: input.value.course_subject_id,
    classGroupIds: input.value.class_group_ids,
    classGroups: classGroups.data || []
  });

  if (duplicates.error) {
    return json(500, { success: false, error: duplicates.error });
  }

  if (duplicates.duplicates.length) {
    return json(409, {
      success: false,
      error: "Fagudbuddet ville skabe dubletter: ét eller flere valgte hold har allerede dette fag i et aktivt fagudbud.",
      duplicates: duplicates.duplicates
    });
  }

  const requirementMismatches = await findRequirementMismatches(client, {
    schoolId,
    courseSubjectId: input.value.course_subject_id,
    classGroupIds: input.value.class_group_ids,
    classGroups: classGroups.data || []
  });

  if (requirementMismatches.error) {
    return json(500, { success: false, error: requirementMismatches.error });
  }

  if (requirementMismatches.mismatches.length && !input.value.allow_requirement_mismatch) {
    return json(409, {
      success: false,
      error: "Et eller flere valgte hold har ikke et fagkrav for dette fag. Bekræft advarslen for at fortsætte.",
      requirement_mismatches: requirementMismatches.mismatches
    });
  }

  const inserted = await client
    .from("subject_offerings")
    .insert({
      school_id: schoolId,
      class_group_id: input.value.class_group_ids[0],
      course_subject_id: input.value.course_subject_id,
      name: subject.data.name,
      total_hours: input.value.total_hours,
      hours_missing: input.value.hours_missing,
      hours_source: input.value.hours_source,
      period_value: input.value.period_value,
      period_unit: input.value.period_unit,
      start_week: input.value.start_week,
      priority: input.value.priority,
      sort_order: input.value.sort_order,
      metadata: metadataForOfferingChange(null, "create")
    })
    .select(OFFERING_SELECT)
    .single<SubjectOfferingRow>();

  if (inserted.error) {
    return json(500, { success: false, error: `subject_offerings insert: ${inserted.error.message}` });
  }

  const changedBy = getAdminIdentityForAudit(adminAuth.user);
  const offeringAudit = await writeOfferingAudit(client, {
    recordId: inserted.data.id,
    changeType: "insert",
    beforeData: null,
    afterData: inserted.data,
    changedBy
  });

  if (offeringAudit.error) {
    return json(500, { success: false, error: `data_change_log insert: ${offeringAudit.error.message}` });
  }

  const sync = await syncMemberships(client, {
    subjectOfferingId: inserted.data.id,
    schoolId,
    classGroupIds: input.value.class_group_ids,
    existing: [],
    changedBy
  });

  if (sync.error) {
    return json(500, { success: false, error: sync.error });
  }

  const memberships = await getMemberships(client, inserted.data.id);

  if (memberships.error) {
    return json(500, { success: false, error: `subject_offering_class_groups: ${memberships.error.message}` });
  }

  return apiOfferingResponse(201, {
    apiStatus: "created",
    offering: inserted.data,
    memberships: (memberships.data || []) as SubjectOfferingMembershipRow[]
  });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthedRequestContext(request);

  if (context.response) return context.response;

  const parsed = await parseJsonBody(request);

  if (parsed.response) return parsed.response;

  const client = context.client!;
  const rawBody = parsed.body!;
  const action = parseAction(rawBody.action, "update");
  const offeringId = normalizeUuid(rawBody.id);

  if (!action || (action !== "update" && action !== "deactivate" && action !== "reactivate")) {
    return json(400, { success: false, error: 'PATCH kræver action "update", "deactivate" eller "reactivate".' });
  }

  if (!offeringId) {
    return json(400, { success: false, error: "id skal være en gyldig uuid." });
  }

  const existing = await getSubjectOffering(client, offeringId);

  if (existing.error) {
    return json(500, { success: false, error: `subject_offerings: ${existing.error.message}` });
  }

  if (!existing.data) {
    return json(404, { success: false, error: "Fagudbud blev ikke fundet." });
  }

  const school = await getSchool(client, existing.data.school_id);

  if (school.error) {
    return json(500, { success: false, error: `schools: ${school.error.message}` });
  }

  if (!school.data) {
    return json(404, { success: false, error: "Skole blev ikke fundet." });
  }

  const adminAuth = await assertAdminOrEditor({
    request,
    organizationId: school.data.organization_id,
    client,
    user: context.userResult!.user
  });

  if ("error" in adminAuth) {
    return json(adminAuth.status, { success: false, error: adminAuth.error });
  }

  const changedBy = getAdminIdentityForAudit(adminAuth.user);

  if (action === "deactivate" || action === "reactivate") {
    const archivedReason = parseArchivedReason(rawBody.archived_reason);

    if (action === "deactivate" && !archivedReason) {
      return json(400, { success: false, error: "archived_reason skal være tekst på højst 240 tegn." });
    }

    const memberships = await getMemberships(client, offeringId);

    if (memberships.error) {
      return json(500, { success: false, error: `subject_offering_class_groups: ${memberships.error.message}` });
    }

    if (action === "deactivate" && existing.data.is_active === false) {
      return apiOfferingResponse(200, {
        apiStatus: "unchanged",
        offering: existing.data,
        memberships: (memberships.data || []) as SubjectOfferingMembershipRow[]
      });
    }

    if (action === "reactivate" && existing.data.is_active === true) {
      return apiOfferingResponse(200, {
        apiStatus: "unchanged",
        offering: existing.data,
        memberships: (memberships.data || []) as SubjectOfferingMembershipRow[]
      });
    }

    const saved = await client
      .from("subject_offerings")
      .update(
        action === "deactivate"
          ? {
              is_active: false,
              archived_at: new Date().toISOString(),
              archived_by: changedBy,
              archived_reason: archivedReason,
              metadata: metadataForOfferingChange(existing.data.metadata, "deactivate")
            }
          : {
              is_active: true,
              archived_at: null,
              archived_by: null,
              archived_reason: null,
              metadata: metadataForOfferingChange(existing.data.metadata, "reactivate")
            }
      )
      .eq("id", offeringId)
      .select(OFFERING_SELECT)
      .single<SubjectOfferingRow>();

    if (saved.error) {
      return json(500, { success: false, error: `subject_offerings lifecycle update: ${saved.error.message}` });
    }

    const audit = await writeOfferingAudit(client, {
      recordId: saved.data.id,
      changeType: "update",
      beforeData: existing.data,
      afterData: saved.data,
      changedBy
    });

    if (audit.error) {
      return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
    }

    return apiOfferingResponse(200, {
      apiStatus: action === "deactivate" ? "deactivated" : "reactivated",
      offering: saved.data,
      memberships: (memberships.data || []) as SubjectOfferingMembershipRow[]
    });
  }

  const input = parseOfferingInput(rawBody);

  if (input.error || !input.value) {
    return json(400, { success: false, error: input.error || "Fagudbudsinput er ugyldigt." });
  }

  const subject = await validateCourseSubject(client, input.value.course_subject_id, existing.data.school_id);

  if (subject.error || !subject.data) {
    return json(subject.error?.startsWith("course_subjects:") ? 500 : 400, { success: false, error: subject.error || "Fag er ugyldigt." });
  }

  const classGroups = await validateClassGroups(client, input.value.class_group_ids, existing.data.school_id);

  if (classGroups.error) {
    return json(classGroups.error.startsWith("class_groups:") ? 500 : 400, { success: false, error: classGroups.error });
  }

  const duplicates = await findDuplicateClassSubjects(client, {
    schoolId: existing.data.school_id,
    courseSubjectId: input.value.course_subject_id,
    classGroupIds: input.value.class_group_ids,
    classGroups: classGroups.data || [],
    excludeSubjectOfferingId: offeringId
  });

  if (duplicates.error) {
    return json(500, { success: false, error: duplicates.error });
  }

  if (duplicates.duplicates.length) {
    return json(409, {
      success: false,
      error: "Fagudbuddet ville skabe dubletter: ét eller flere valgte hold har allerede dette fag i et andet aktivt fagudbud.",
      duplicates: duplicates.duplicates
    });
  }

  const requirementMismatches = await findRequirementMismatches(client, {
    schoolId: existing.data.school_id,
    courseSubjectId: input.value.course_subject_id,
    classGroupIds: input.value.class_group_ids,
    classGroups: classGroups.data || []
  });

  if (requirementMismatches.error) {
    return json(500, { success: false, error: requirementMismatches.error });
  }

  if (requirementMismatches.mismatches.length && !input.value.allow_requirement_mismatch) {
    return json(409, {
      success: false,
      error: "Et eller flere valgte hold har ikke et fagkrav for dette fag. Bekræft advarslen for at fortsætte.",
      requirement_mismatches: requirementMismatches.mismatches
    });
  }

  const existingMemberships = await getMemberships(client, offeringId);

  if (existingMemberships.error) {
    return json(500, { success: false, error: `subject_offering_class_groups: ${existingMemberships.error.message}` });
  }

  const membershipsBefore = (existingMemberships.data || []) as SubjectOfferingMembershipRow[];
  const offeringChanged = hasOfferingChanges(existing.data, input.value, subject.data.name);
  const membershipsChanged = !sameClassGroupOrder(membershipsBefore, input.value.class_group_ids);

  if (!offeringChanged && !membershipsChanged) {
    return apiOfferingResponse(200, {
      apiStatus: "unchanged",
      offering: existing.data,
      memberships: membershipsBefore
    });
  }

  const saved = offeringChanged
    ? await client
        .from("subject_offerings")
        .update({
          class_group_id: input.value.class_group_ids[0],
          course_subject_id: input.value.course_subject_id,
          name: subject.data.name,
          total_hours: input.value.total_hours,
          hours_missing: input.value.hours_missing,
          hours_source: input.value.hours_source,
          period_value: input.value.period_value,
          period_unit: input.value.period_unit,
          start_week: input.value.start_week,
          priority: input.value.priority,
          sort_order: input.value.sort_order,
          metadata: metadataForOfferingChange(existing.data.metadata, "update")
        })
        .eq("id", offeringId)
        .select(OFFERING_SELECT)
        .single<SubjectOfferingRow>()
    : { data: existing.data, error: null };

  if (saved.error) {
    return json(500, { success: false, error: `subject_offerings update: ${saved.error.message}` });
  }

  if (offeringChanged) {
    const audit = await writeOfferingAudit(client, {
      recordId: saved.data.id,
      changeType: "update",
      beforeData: existing.data,
      afterData: saved.data,
      changedBy
    });

    if (audit.error) {
      return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
    }
  }

  if (membershipsChanged) {
    const sync = await syncMemberships(client, {
      subjectOfferingId: offeringId,
      schoolId: existing.data.school_id,
      classGroupIds: input.value.class_group_ids,
      existing: membershipsBefore,
      changedBy
    });

    if (sync.error) {
      return json(500, { success: false, error: sync.error });
    }
  }

  const membershipsAfter = await getMemberships(client, offeringId);

  if (membershipsAfter.error) {
    return json(500, { success: false, error: `subject_offering_class_groups: ${membershipsAfter.error.message}` });
  }

  return apiOfferingResponse(200, {
    apiStatus: "updated",
    offering: saved.data,
    memberships: (membershipsAfter.data || []) as SubjectOfferingMembershipRow[]
  });
}

import { NextRequest, NextResponse } from "next/server";
import { assertAdminOrEditor, getAdminIdentityForAudit, getRequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "add" | "remove";
type CompetencyLevel = "primary" | "secondary" | "certified";
type RequestBody = {
  action?: unknown;
  teacher_id?: unknown;
  course_subject_id?: unknown;
  level?: unknown;
};
type BaseRow = {
  id: string;
  school_id: string;
};
type SchoolRow = {
  id: string;
  organization_id: string;
};
type CompetencyRow = {
  id: string;
  school_id: string;
  teacher_id: string;
  course_subject_id: string;
  level: CompetencyLevel;
  metadata: Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVELS = new Set<CompetencyLevel>(["primary", "secondary", "certified"]);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is RequestBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseAction(value: unknown): Action | null {
  return value === "add" || value === "remove" ? value : null;
}

function parseLevel(value: unknown): CompetencyLevel | null {
  if (value === undefined || value === null || value === "") return "primary";
  return typeof value === "string" && LEVELS.has(value as CompetencyLevel) ? (value as CompetencyLevel) : null;
}

async function findSchoolRows(client: ReturnType<typeof createServerSupabaseAdminClient>, teacherId: string, courseSubjectId: string) {
  if (!client) {
    return { teacher: null, subject: null, error: "Supabase server client kunne ikke oprettes." };
  }

  const [teacherResult, subjectResult] = await Promise.all([
    client.from("teachers").select("id,school_id").eq("id", teacherId).maybeSingle<BaseRow>(),
    client.from("course_subjects").select("id,school_id").eq("id", courseSubjectId).maybeSingle<BaseRow>()
  ]);

  if (teacherResult.error) return { teacher: null, subject: null, error: `teachers: ${teacherResult.error.message}` };
  if (subjectResult.error) return { teacher: null, subject: null, error: `course_subjects: ${subjectResult.error.message}` };

  return {
    teacher: teacherResult.data,
    subject: subjectResult.data,
    error: null
  };
}

async function findCompetency(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  teacherId: string,
  courseSubjectId: string,
  level: CompetencyLevel
) {
  return client
    .from("teacher_competencies")
    .select("id,school_id,teacher_id,course_subject_id,level,metadata")
    .eq("teacher_id", teacherId)
    .eq("course_subject_id", courseSubjectId)
    .eq("level", level)
    .maybeSingle<CompetencyRow>();
}

async function writeAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string | null;
    changeType: "competency_add" | "competency_remove";
    beforeData: CompetencyRow | null;
    afterData: CompetencyRow | null;
    teacherId: string;
    courseSubjectId: string;
    level: CompetencyLevel;
    changedBy: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "teacher_competencies",
    record_id: input.recordId,
    change_type: input.changeType,
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/teacher-competencies",
      teacher_id: input.teacherId,
      course_subject_id: input.courseSubjectId,
      level: input.level
    }
  });
}

export async function POST(request: NextRequest) {
  // TODO: Keep this route disconnected from UI until Supabase Auth + organization_members role checks are tested end-to-end.
  const config = getServerSupabaseConfig();
  const client = createServerSupabaseAdminClient();

  if (!client) {
    return json(500, { success: false, error: config.issue || "Supabase server client mangler konfiguration." });
  }

  const userResult = await getRequestUser(request, client);

  if ("error" in userResult) {
    return json(userResult.status, { success: false, error: userResult.error });
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return json(400, { success: false, error: "Request body skal være JSON." });
  }

  if (!isRecord(rawBody)) {
    return json(400, { success: false, error: "Request body skal være et JSON object." });
  }

  const action = parseAction(rawBody.action);
  const level = parseLevel(rawBody.level);

  if (!action) {
    return json(400, { success: false, error: 'action skal være "add" eller "remove".' });
  }

  if (!isUuid(rawBody.teacher_id)) {
    return json(400, { success: false, error: "teacher_id skal være en gyldig uuid." });
  }

  if (!isUuid(rawBody.course_subject_id)) {
    return json(400, { success: false, error: "course_subject_id skal være en gyldig uuid." });
  }

  if (!level) {
    return json(400, { success: false, error: 'level skal være "primary", "secondary" eller "certified".' });
  }

  const schoolRows = await findSchoolRows(client, rawBody.teacher_id, rawBody.course_subject_id);

  if (schoolRows.error) {
    return json(500, { success: false, error: schoolRows.error });
  }

  if (!schoolRows.teacher) {
    return json(404, { success: false, error: "Lærer blev ikke fundet." });
  }

  if (!schoolRows.subject) {
    return json(404, { success: false, error: "Fag blev ikke fundet." });
  }

  if (schoolRows.teacher.school_id !== schoolRows.subject.school_id) {
    return json(400, { success: false, error: "Lærer og fag hører ikke til samme skole." });
  }

  const school = await client
    .from("schools")
    .select("id,organization_id")
    .eq("id", schoolRows.teacher.school_id)
    .single<SchoolRow>();

  if (school.error) {
    return json(500, { success: false, error: `schools: ${school.error.message}` });
  }

  const adminAuth = await assertAdminOrEditor({
    request,
    organizationId: school.data.organization_id,
    client,
    user: userResult.user
  });

  if ("error" in adminAuth) {
    return json(adminAuth.status, { success: false, error: adminAuth.error });
  }

  const changedBy = getAdminIdentityForAudit(adminAuth.user);

  const existing = await findCompetency(client, rawBody.teacher_id, rawBody.course_subject_id, level);

  if (existing.error) {
    return json(500, { success: false, error: `teacher_competencies: ${existing.error.message}` });
  }

  if (action === "add") {
    if (existing.data) {
      return json(200, { success: true, status: "exists", competency: existing.data });
    }

    const inserted = await client
      .from("teacher_competencies")
      .insert({
        school_id: schoolRows.teacher.school_id,
        teacher_id: rawBody.teacher_id,
        course_subject_id: rawBody.course_subject_id,
        level,
        metadata: {
          source: "admin_route_preview"
        }
      })
      .select("id,school_id,teacher_id,course_subject_id,level,metadata")
      .single<CompetencyRow>();

    if (inserted.error) {
      return json(500, { success: false, error: `teacher_competencies insert: ${inserted.error.message}` });
    }

    const audit = await writeAudit(client, {
      recordId: inserted.data.id,
      changeType: "competency_add",
      beforeData: null,
      afterData: inserted.data,
      teacherId: rawBody.teacher_id,
      courseSubjectId: rawBody.course_subject_id,
      level,
      changedBy
    });

    if (audit.error) {
      return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
    }

    return json(201, { success: true, status: "created", competency: inserted.data });
  }

  if (!existing.data) {
    return json(404, { success: false, error: "Kompetencen blev ikke fundet." });
  }

  const removed = await client.from("teacher_competencies").delete().eq("id", existing.data.id);

  if (removed.error) {
    return json(500, { success: false, error: `teacher_competencies delete: ${removed.error.message}` });
  }

  const audit = await writeAudit(client, {
    recordId: existing.data.id,
    changeType: "competency_remove",
    beforeData: existing.data,
    afterData: null,
    teacherId: rawBody.teacher_id,
    courseSubjectId: rawBody.course_subject_id,
    level,
    changedBy
  });

  if (audit.error) {
    return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
  }

  return json(200, { success: true, status: "removed", competency: existing.data });
}

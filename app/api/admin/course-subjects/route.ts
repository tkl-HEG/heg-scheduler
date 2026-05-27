import { NextRequest, NextResponse } from "next/server";
import { assertAdminOrEditor, getAdminIdentityForAudit, getRequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "create" | "update" | "deactivate";
type RequestBody = {
  action?: unknown;
  id?: unknown;
  school_id?: unknown;
  name?: unknown;
  normalized_key?: unknown;
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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_SELECT = "id,school_id,name,normalized_key,metadata,created_at,updated_at";
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

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
  return value === "create" || value === "update" || value === "deactivate" ? value : null;
}

function parseName(value: unknown) {
  if (typeof value !== "string") return { value: null, error: "name skal være tekst." };

  const trimmed = value.trim();

  if (!trimmed) return { value: null, error: "name skal udfyldes." };
  if (trimmed.length > 160) return { value: null, error: "name må højst være 160 tegn." };
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return { value: null, error: "name må ikke indeholde kontroltegn." };

  return { value: trimmed, error: null };
}

function parseNormalizedKey(value: unknown) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };
  if (typeof value !== "string") return { value: null, error: "normalized_key skal være tekst eller null." };

  const trimmed = value.trim();

  if (!trimmed) return { value: null, error: null };
  if (trimmed.length > 160) return { value: null, error: "normalized_key må højst være 160 tegn." };
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return { value: null, error: "normalized_key må ikke indeholde kontroltegn." };
  }

  return { value: trimmed, error: null };
}

function metadataForChange(existing: Record<string, unknown> | null | undefined, action: Action) {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    last_admin_update: {
      route: "/api/admin/course-subjects",
      action,
      source: "admin_subjects_ui"
    }
  };
}

async function writeAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string;
    changeType: "insert" | "update";
    beforeData: CourseSubjectRow | null;
    afterData: CourseSubjectRow;
    changedBy: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "course_subjects",
    record_id: input.recordId,
    change_type: input.changeType,
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/course-subjects",
      school_id: input.afterData.school_id,
      subject_name: input.afterData.name,
      normalized_key: input.afterData.normalized_key
    }
  });
}

async function getSchool(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  schoolId: string
) {
  return client.from("schools").select("id,organization_id").eq("id", schoolId).maybeSingle<SchoolRow>();
}

async function getCourseSubject(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  id: string
) {
  return client.from("course_subjects").select(SUBJECT_SELECT).eq("id", id).maybeSingle<CourseSubjectRow>();
}

async function findSubjectConflict(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    schoolId: string;
    name: string;
    normalizedKey: string | null;
    excludeId?: string | null;
  }
) {
  let nameQuery = client
    .from("course_subjects")
    .select("id,name,normalized_key")
    .eq("school_id", input.schoolId)
    .eq("name", input.name);

  if (input.excludeId) {
    nameQuery = nameQuery.neq("id", input.excludeId);
  }

  const nameMatch = await nameQuery.maybeSingle<{ id: string; name: string; normalized_key: string | null }>();

  if (nameMatch.error) {
    return { error: `course_subjects conflict name: ${nameMatch.error.message}`, conflict: null };
  }

  if (nameMatch.data) {
    return { error: null, conflict: `Der findes allerede et fag med navnet "${input.name}".` };
  }

  if (!input.normalizedKey) {
    return { error: null, conflict: null };
  }

  let keyQuery = client
    .from("course_subjects")
    .select("id,name,normalized_key")
    .eq("school_id", input.schoolId)
    .eq("normalized_key", input.normalizedKey);

  if (input.excludeId) {
    keyQuery = keyQuery.neq("id", input.excludeId);
  }

  const keyMatch = await keyQuery.maybeSingle<{ id: string; name: string; normalized_key: string | null }>();

  if (keyMatch.error) {
    return { error: `course_subjects conflict normalized_key: ${keyMatch.error.message}`, conflict: null };
  }

  if (keyMatch.data) {
    return { error: null, conflict: `Der findes allerede et fag med nøglen "${input.normalizedKey}".` };
  }

  return { error: null, conflict: null };
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
  const name = parseName(rawBody.name);
  const normalizedKey = parseNormalizedKey(rawBody.normalized_key);

  if (!schoolId) {
    return json(400, { success: false, error: "school_id skal være en gyldig uuid." });
  }

  if (name.error || !name.value) {
    return json(400, { success: false, error: name.error || "name er ugyldig." });
  }

  if (normalizedKey.error) {
    return json(400, { success: false, error: normalizedKey.error });
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

  const conflict = await findSubjectConflict(client, {
    schoolId,
    name: name.value,
    normalizedKey: normalizedKey.value
  });

  if (conflict.error) {
    return json(500, { success: false, error: conflict.error });
  }

  if (conflict.conflict) {
    return json(409, { success: false, error: conflict.conflict });
  }

  const inserted = await client
    .from("course_subjects")
    .insert({
      school_id: schoolId,
      name: name.value,
      normalized_key: normalizedKey.value,
      metadata: metadataForChange(null, "create")
    })
    .select(SUBJECT_SELECT)
    .single<CourseSubjectRow>();

  if (inserted.error) {
    return json(500, { success: false, error: `course_subjects insert: ${inserted.error.message}` });
  }

  const audit = await writeAudit(client, {
    recordId: inserted.data.id,
    changeType: "insert",
    beforeData: null,
    afterData: inserted.data,
    changedBy: getAdminIdentityForAudit(adminAuth.user)
  });

  if (audit.error) {
    return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
  }

  return json(201, { success: true, status: "created", subject: inserted.data });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthedRequestContext(request);

  if (context.response) return context.response;

  const parsed = await parseJsonBody(request);

  if (parsed.response) return parsed.response;

  const client = context.client!;
  const rawBody = parsed.body!;
  const action = parseAction(rawBody.action, "update");
  const subjectId = normalizeUuid(rawBody.id);

  if (!action || (action !== "update" && action !== "deactivate")) {
    return json(400, { success: false, error: 'PATCH kræver action "update" eller "deactivate".' });
  }

  if (!subjectId) {
    return json(400, { success: false, error: "id skal være en gyldig uuid." });
  }

  const existing = await getCourseSubject(client, subjectId);

  if (existing.error) {
    return json(500, { success: false, error: `course_subjects: ${existing.error.message}` });
  }

  if (!existing.data) {
    return json(404, { success: false, error: "Fag blev ikke fundet." });
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

  if (action === "deactivate") {
    return json(400, {
      success: false,
      error:
        "course_subjects har ikke is_active, status eller archived_at. Hard delete er ikke tilladt; tilføj en migration før deaktivering."
    });
  }

  const name = parseName(rawBody.name);
  const normalizedKey = parseNormalizedKey(rawBody.normalized_key);

  if (name.error || !name.value) {
    return json(400, { success: false, error: name.error || "name er ugyldig." });
  }

  if (normalizedKey.error) {
    return json(400, { success: false, error: normalizedKey.error });
  }

  const changed =
    existing.data.name !== name.value || (existing.data.normalized_key || null) !== (normalizedKey.value || null);

  if (!changed) {
    return json(200, { success: true, status: "unchanged", subject: existing.data });
  }

  const conflict = await findSubjectConflict(client, {
    schoolId: existing.data.school_id,
    name: name.value,
    normalizedKey: normalizedKey.value,
    excludeId: subjectId
  });

  if (conflict.error) {
    return json(500, { success: false, error: conflict.error });
  }

  if (conflict.conflict) {
    return json(409, { success: false, error: conflict.conflict });
  }

  const saved = await client
    .from("course_subjects")
    .update({
      name: name.value,
      normalized_key: normalizedKey.value,
      metadata: metadataForChange(existing.data.metadata, "update")
    })
    .eq("id", subjectId)
    .select(SUBJECT_SELECT)
    .single<CourseSubjectRow>();

  if (saved.error) {
    return json(500, { success: false, error: `course_subjects update: ${saved.error.message}` });
  }

  const audit = await writeAudit(client, {
    recordId: saved.data.id,
    changeType: "update",
    beforeData: existing.data,
    afterData: saved.data,
    changedBy: getAdminIdentityForAudit(adminAuth.user)
  });

  if (audit.error) {
    return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
  }

  return json(200, { success: true, status: "updated", subject: saved.data });
}

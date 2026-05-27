import { NextRequest, NextResponse } from "next/server";
import { assertAdminOrEditor, getAdminIdentityForAudit, getRequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "create" | "update" | "deactivate" | "reactivate";
type RequestBody = {
  action?: unknown;
  id?: unknown;
  school_id?: unknown;
  name?: unknown;
  legacy_id?: unknown;
  address_label?: unknown;
  campus_id?: unknown;
  class_category_id?: unknown;
  education_program_id?: unknown;
  default_period_weeks?: unknown;
  planning_notes?: unknown;
  scheduling_notes?: unknown;
  archived_reason?: unknown;
};
type SchoolRow = {
  id: string;
  organization_id: string;
};
type ClassGroupRow = {
  id: string;
  school_id: string;
  campus_id: string | null;
  legacy_id: string | null;
  name: string;
  address_label: string;
  preferred_room_id: string | null;
  default_period_weeks: number | null;
  class_category_id: string | null;
  education_program_id: string | null;
  planning_notes: string | null;
  scheduling_notes: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASS_GROUP_SELECT =
  "id,school_id,campus_id,legacy_id,name,address_label,preferred_room_id,default_period_weeks,class_category_id,education_program_id,planning_notes,scheduling_notes,metadata,is_active,archived_at,archived_by,archived_reason,created_at,updated_at";
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

function optionalUuid(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };

  const parsed = normalizeUuid(value);
  return parsed ? { value: parsed, error: null } : { value: null, error: `${fieldName} skal være en gyldig uuid eller tom.` };
}

function parseAction(value: unknown, fallback: Action): Action | null {
  if (value === undefined || value === null || value === "") return fallback;
  return value === "create" || value === "update" || value === "deactivate" || value === "reactivate" ? value : null;
}

function parseRequiredText(value: unknown, fieldName: string, maxLength = 160) {
  if (typeof value !== "string") return { value: null, error: `${fieldName} skal være tekst.` };

  const trimmed = value.trim();

  if (!trimmed) return { value: null, error: `${fieldName} skal udfyldes.` };
  if (trimmed.length > maxLength) return { value: null, error: `${fieldName} må højst være ${maxLength} tegn.` };
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return { value: null, error: `${fieldName} må ikke indeholde kontroltegn.` };

  return { value: trimmed, error: null };
}

function parseOptionalText(value: unknown, fieldName: string, maxLength = 500) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };
  if (typeof value !== "string") return { value: null, error: `${fieldName} skal være tekst eller tom.` };

  const trimmed = value.trim();

  if (!trimmed) return { value: null, error: null };
  if (trimmed.length > maxLength) return { value: null, error: `${fieldName} må højst være ${maxLength} tegn.` };
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return { value: null, error: `${fieldName} må ikke indeholde kontroltegn.` };

  return { value: trimmed, error: null };
}

function parseOptionalInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return { value: null, error: null };
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 500) {
    return { value: null, error: `${fieldName} skal være et heltal mellem 1 og 500 eller tom.` };
  }

  return { value: parsed, error: null };
}

function parseArchivedReason(value: unknown) {
  if (value === undefined || value === null || value === "") return "Admin deactivation from /admin/hold";
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (!trimmed) return "Admin deactivation from /admin/hold";
  if (trimmed.length > 240) return null;
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return null;

  return trimmed;
}

function metadataForChange(existing: Record<string, unknown> | null | undefined, action: Action) {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    last_admin_update: {
      route: "/api/admin/holds",
      action,
      source: "admin_holds_ui"
    }
  };
}

function parseHoldInput(rawBody: RequestBody) {
  const name = parseRequiredText(rawBody.name, "name", 160);
  const legacyId = parseOptionalText(rawBody.legacy_id, "legacy_id", 120);
  const addressLabel = parseRequiredText(rawBody.address_label, "address_label", 180);
  const campusId = optionalUuid(rawBody.campus_id, "campus_id");
  const classCategoryId = optionalUuid(rawBody.class_category_id, "class_category_id");
  const educationProgramId = optionalUuid(rawBody.education_program_id, "education_program_id");
  const defaultPeriodWeeks = parseOptionalInteger(rawBody.default_period_weeks, "default_period_weeks");
  const planningNotes = parseOptionalText(rawBody.planning_notes, "planning_notes", 1000);
  const schedulingNotes = parseOptionalText(rawBody.scheduling_notes, "scheduling_notes", 1000);
  const firstError =
    name.error ||
    legacyId.error ||
    addressLabel.error ||
    campusId.error ||
    classCategoryId.error ||
    educationProgramId.error ||
    defaultPeriodWeeks.error ||
    planningNotes.error ||
    schedulingNotes.error;

  if (firstError || !name.value || !addressLabel.value) {
    return { value: null, error: firstError || "Holdinput er ugyldigt." };
  }

  return {
    value: {
      name: name.value,
      legacy_id: legacyId.value,
      address_label: addressLabel.value,
      campus_id: campusId.value,
      class_category_id: classCategoryId.value,
      education_program_id: educationProgramId.value,
      default_period_weeks: defaultPeriodWeeks.value,
      planning_notes: planningNotes.value,
      scheduling_notes: schedulingNotes.value
    },
    error: null
  };
}

async function writeAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string;
    changeType: "insert" | "update";
    beforeData: ClassGroupRow | null;
    afterData: ClassGroupRow;
    changedBy: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "class_groups",
    record_id: input.recordId,
    change_type: input.changeType,
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/holds",
      school_id: input.afterData.school_id,
      class_group_name: input.afterData.name,
      legacy_id: input.afterData.legacy_id,
      is_active: input.afterData.is_active
    }
  });
}

async function getSchool(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  schoolId: string
) {
  return client.from("schools").select("id,organization_id").eq("id", schoolId).maybeSingle<SchoolRow>();
}

async function getClassGroup(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  id: string
) {
  return client.from("class_groups").select(CLASS_GROUP_SELECT).eq("id", id).maybeSingle<ClassGroupRow>();
}

async function validateOptionalReference(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: { table: "campuses" | "class_categories" | "education_programs"; id: string | null; schoolId: string; label: string }
) {
  if (!input.id) return null;

  const result = await client.from(input.table).select("id,school_id").eq("id", input.id).maybeSingle<{ id: string; school_id: string }>();

  if (result.error) return `${input.table}: ${result.error.message}`;
  if (!result.data) return `${input.label} blev ikke fundet.`;
  if (result.data.school_id !== input.schoolId) return `${input.label} hører ikke til samme skole.`;

  return null;
}

async function findClassGroupConflict(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    schoolId: string;
    name: string;
    legacyId: string | null;
    excludeId?: string | null;
  }
) {
  let nameQuery = client.from("class_groups").select("id,name,legacy_id").eq("school_id", input.schoolId).eq("name", input.name);

  if (input.excludeId) {
    nameQuery = nameQuery.neq("id", input.excludeId);
  }

  const nameMatch = await nameQuery.maybeSingle<{ id: string; name: string; legacy_id: string | null }>();

  if (nameMatch.error) {
    return { error: `class_groups conflict name: ${nameMatch.error.message}`, conflict: null };
  }

  if (nameMatch.data) {
    return { error: null, conflict: `Der findes allerede et hold med navnet "${input.name}".` };
  }

  if (!input.legacyId) {
    return { error: null, conflict: null };
  }

  let legacyQuery = client
    .from("class_groups")
    .select("id,name,legacy_id")
    .eq("school_id", input.schoolId)
    .eq("legacy_id", input.legacyId);

  if (input.excludeId) {
    legacyQuery = legacyQuery.neq("id", input.excludeId);
  }

  const legacyMatch = await legacyQuery.maybeSingle<{ id: string; name: string; legacy_id: string | null }>();

  if (legacyMatch.error) {
    return { error: `class_groups conflict legacy_id: ${legacyMatch.error.message}`, conflict: null };
  }

  if (legacyMatch.data) {
    return { error: null, conflict: `Der findes allerede et hold med importnøglen "${input.legacyId}".` };
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

  if (!schoolId) {
    return json(400, { success: false, error: "school_id skal være en gyldig uuid." });
  }

  const input = parseHoldInput(rawBody);

  if (input.error || !input.value) {
    return json(400, { success: false, error: input.error || "Holdinput er ugyldigt." });
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

  const referenceErrors = await Promise.all([
    validateOptionalReference(client, { table: "campuses", id: input.value.campus_id, schoolId, label: "Campus" }),
    validateOptionalReference(client, { table: "class_categories", id: input.value.class_category_id, schoolId, label: "Kategori" }),
    validateOptionalReference(client, {
      table: "education_programs",
      id: input.value.education_program_id,
      schoolId,
      label: "Program"
    })
  ]);
  const referenceError = referenceErrors.find(Boolean);

  if (referenceError) {
    return json(400, { success: false, error: referenceError });
  }

  const conflict = await findClassGroupConflict(client, {
    schoolId,
    name: input.value.name,
    legacyId: input.value.legacy_id
  });

  if (conflict.error) {
    return json(500, { success: false, error: conflict.error });
  }

  if (conflict.conflict) {
    return json(409, { success: false, error: conflict.conflict });
  }

  const inserted = await client
    .from("class_groups")
    .insert({
      school_id: schoolId,
      ...input.value,
      metadata: metadataForChange(null, "create")
    })
    .select(CLASS_GROUP_SELECT)
    .single<ClassGroupRow>();

  if (inserted.error) {
    return json(500, { success: false, error: `class_groups insert: ${inserted.error.message}` });
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

  return json(201, { success: true, status: "created", hold: inserted.data });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthedRequestContext(request);

  if (context.response) return context.response;

  const parsed = await parseJsonBody(request);

  if (parsed.response) return parsed.response;

  const client = context.client!;
  const rawBody = parsed.body!;
  const action = parseAction(rawBody.action, "update");
  const holdId = normalizeUuid(rawBody.id);

  if (!action || (action !== "update" && action !== "deactivate" && action !== "reactivate")) {
    return json(400, { success: false, error: 'PATCH kræver action "update", "deactivate" eller "reactivate".' });
  }

  if (!holdId) {
    return json(400, { success: false, error: "id skal være en gyldig uuid." });
  }

  const existing = await getClassGroup(client, holdId);

  if (existing.error) {
    return json(500, { success: false, error: `class_groups: ${existing.error.message}` });
  }

  if (!existing.data) {
    return json(404, { success: false, error: "Hold blev ikke fundet." });
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

  if (action === "deactivate" || action === "reactivate") {
    const changedBy = getAdminIdentityForAudit(adminAuth.user);
    const archivedReason = parseArchivedReason(rawBody.archived_reason);

    if (action === "deactivate" && !archivedReason) {
      return json(400, { success: false, error: "archived_reason skal være tekst på højst 240 tegn." });
    }

    if (action === "deactivate" && existing.data.is_active === false) {
      return json(200, { success: true, status: "unchanged", hold: existing.data });
    }

    if (action === "reactivate" && existing.data.is_active === true) {
      return json(200, { success: true, status: "unchanged", hold: existing.data });
    }

    const saved = await client
      .from("class_groups")
      .update(
        action === "deactivate"
          ? {
              is_active: false,
              archived_at: new Date().toISOString(),
              archived_by: changedBy,
              archived_reason: archivedReason,
              metadata: metadataForChange(existing.data.metadata, "deactivate")
            }
          : {
              is_active: true,
              archived_at: null,
              archived_by: null,
              archived_reason: null,
              metadata: metadataForChange(existing.data.metadata, "reactivate")
            }
      )
      .eq("id", holdId)
      .select(CLASS_GROUP_SELECT)
      .single<ClassGroupRow>();

    if (saved.error) {
      return json(500, { success: false, error: `class_groups lifecycle update: ${saved.error.message}` });
    }

    const audit = await writeAudit(client, {
      recordId: saved.data.id,
      changeType: "update",
      beforeData: existing.data,
      afterData: saved.data,
      changedBy
    });

    if (audit.error) {
      return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
    }

    return json(200, {
      success: true,
      status: action === "deactivate" ? "deactivated" : "reactivated",
      hold: saved.data
    });
  }

  const input = parseHoldInput(rawBody);

  if (input.error || !input.value) {
    return json(400, { success: false, error: input.error || "Holdinput er ugyldigt." });
  }

  const referenceErrors = await Promise.all([
    validateOptionalReference(client, {
      table: "campuses",
      id: input.value.campus_id,
      schoolId: existing.data.school_id,
      label: "Campus"
    }),
    validateOptionalReference(client, {
      table: "class_categories",
      id: input.value.class_category_id,
      schoolId: existing.data.school_id,
      label: "Kategori"
    }),
    validateOptionalReference(client, {
      table: "education_programs",
      id: input.value.education_program_id,
      schoolId: existing.data.school_id,
      label: "Program"
    })
  ]);
  const referenceError = referenceErrors.find(Boolean);

  if (referenceError) {
    return json(400, { success: false, error: referenceError });
  }

  const conflict = await findClassGroupConflict(client, {
    schoolId: existing.data.school_id,
    name: input.value.name,
    legacyId: input.value.legacy_id,
    excludeId: holdId
  });

  if (conflict.error) {
    return json(500, { success: false, error: conflict.error });
  }

  if (conflict.conflict) {
    return json(409, { success: false, error: conflict.conflict });
  }

  const changed =
    existing.data.name !== input.value.name ||
    (existing.data.legacy_id || null) !== (input.value.legacy_id || null) ||
    existing.data.address_label !== input.value.address_label ||
    (existing.data.campus_id || null) !== (input.value.campus_id || null) ||
    (existing.data.class_category_id || null) !== (input.value.class_category_id || null) ||
    (existing.data.education_program_id || null) !== (input.value.education_program_id || null) ||
    (existing.data.default_period_weeks || null) !== (input.value.default_period_weeks || null) ||
    (existing.data.planning_notes || null) !== (input.value.planning_notes || null) ||
    (existing.data.scheduling_notes || null) !== (input.value.scheduling_notes || null);

  if (!changed) {
    return json(200, { success: true, status: "unchanged", hold: existing.data });
  }

  const saved = await client
    .from("class_groups")
    .update({
      ...input.value,
      metadata: metadataForChange(existing.data.metadata, "update")
    })
    .eq("id", holdId)
    .select(CLASS_GROUP_SELECT)
    .single<ClassGroupRow>();

  if (saved.error) {
    return json(500, { success: false, error: `class_groups update: ${saved.error.message}` });
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

  return json(200, { success: true, status: "updated", hold: saved.data });
}

import { NextRequest, NextResponse } from "next/server";
import { assertAdminOrEditor, getAdminIdentityForAudit, getRequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RequestBody = {
  teacher_id?: unknown;
  workload_year_id?: unknown;
  allocated_hours?: unknown;
};

type TeacherRow = {
  id: string;
  school_id: string;
};

type WorkloadYearRow = {
  id: string;
  school_id: string;
  label: string;
};

type SchoolRow = {
  id: string;
  organization_id: string;
};

type AllocationRow = {
  id: string;
  workload_year_id: string;
  teacher_id: string;
  allocated_hours: number;
  teaching_hours_target: number | null;
  non_teaching_hours: number | null;
  notes: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOCATION_SELECT =
  "id,workload_year_id,teacher_id,allocated_hours,teaching_hours_target,non_teaching_hours,notes,source,metadata,created_at,updated_at";

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

function invalidInput(status: number, error: string, body: RequestBody) {
  const response: Record<string, unknown> = { success: false, error };

  if (process.env.NODE_ENV !== "production") {
    response.debug = {
      received: {
        teacher_id: body.teacher_id,
        workload_year_id: body.workload_year_id,
        allocated_hours: body.allocated_hours
      }
    };
  }

  return json(status, response);
}

function parseAllocatedHours(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999.99) return null;

  return Math.round(parsed * 100) / 100;
}

async function writeAudit(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  input: {
    recordId: string;
    beforeData: AllocationRow | null;
    afterData: AllocationRow;
    changedBy: string;
  }
) {
  return client.from("data_change_log").insert({
    table_name: "teacher_workload_allocations",
    record_id: input.recordId,
    change_type: "upsert",
    before_data: input.beforeData,
    after_data: input.afterData,
    changed_by: input.changedBy,
    source: "app",
    metadata: {
      route: "/api/admin/teacher-workload-allocations",
      teacher_id: input.afterData.teacher_id,
      workload_year_id: input.afterData.workload_year_id,
      allocated_hours: input.afterData.allocated_hours
    }
  });
}

export async function PATCH(request: NextRequest) {
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

  const teacherId = normalizeUuid(rawBody.teacher_id);
  const workloadYearId = normalizeUuid(rawBody.workload_year_id);

  if (!teacherId) {
    return invalidInput(400, "teacher_id skal være en gyldig uuid.", rawBody);
  }

  if (!workloadYearId) {
    return invalidInput(400, "workload_year_id skal være en gyldig uuid.", rawBody);
  }

  const allocatedHours = parseAllocatedHours(rawBody.allocated_hours);

  if (allocatedHours === null) {
    return invalidInput(400, "allocated_hours skal være et tal mellem 0 og 999999.99.", rawBody);
  }

  const [teacherResult, workloadYearResult] = await Promise.all([
    client.from("teachers").select("id,school_id").eq("id", teacherId).maybeSingle<TeacherRow>(),
    client.from("workload_years").select("id,school_id,label").eq("id", workloadYearId).maybeSingle<WorkloadYearRow>()
  ]);

  if (teacherResult.error) {
    return json(500, { success: false, error: `teachers: ${teacherResult.error.message}` });
  }

  if (workloadYearResult.error) {
    return json(500, { success: false, error: `workload_years: ${workloadYearResult.error.message}` });
  }

  if (!teacherResult.data) {
    return json(404, { success: false, error: "Lærer blev ikke fundet." });
  }

  if (!workloadYearResult.data) {
    return json(404, { success: false, error: "Workload year blev ikke fundet." });
  }

  if (teacherResult.data.school_id !== workloadYearResult.data.school_id) {
    return json(400, { success: false, error: "Lærer og workload year hører ikke til samme skole." });
  }

  const school = await client
    .from("schools")
    .select("id,organization_id")
    .eq("id", workloadYearResult.data.school_id)
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

  const existing = await client
    .from("teacher_workload_allocations")
    .select(ALLOCATION_SELECT)
    .eq("workload_year_id", workloadYearId)
    .eq("teacher_id", teacherId)
    .maybeSingle<AllocationRow>();

  if (existing.error) {
    return json(500, { success: false, error: `teacher_workload_allocations: ${existing.error.message}` });
  }

  const metadata = {
    ...(existing.data?.metadata || {}),
    last_admin_update: {
      route: "/api/admin/teacher-workload-allocations",
      source: "admin_workload_ui"
    }
  };

  const saved = existing.data
    ? await client
        .from("teacher_workload_allocations")
        .update({
          allocated_hours: allocatedHours,
          metadata
        })
        .eq("id", existing.data.id)
        .select(ALLOCATION_SELECT)
        .single<AllocationRow>()
    : await client
        .from("teacher_workload_allocations")
        .insert({
          workload_year_id: workloadYearId,
          teacher_id: teacherId,
          allocated_hours: allocatedHours,
          source: "admin_ui",
          metadata
        })
        .select(ALLOCATION_SELECT)
        .single<AllocationRow>();

  if (saved.error) {
    return json(500, { success: false, error: `teacher_workload_allocations save: ${saved.error.message}` });
  }

  const audit = await writeAudit(client, {
    recordId: saved.data.id,
    beforeData: existing.data,
    afterData: saved.data,
    changedBy: getAdminIdentityForAudit(adminAuth.user)
  });

  if (audit.error) {
    return json(500, { success: false, error: `data_change_log insert: ${audit.error.message}` });
  }

  return json(existing.data ? 200 : 201, {
    success: true,
    status: existing.data ? "updated" : "created",
    allocation: saved.data
  });
}

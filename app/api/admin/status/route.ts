import { NextRequest, NextResponse } from "next/server";
import { getRequestUser, type AdminMembership, type AdminRole, type RequestUser } from "../../../../lib/adminAuth";
import { createServerSupabaseAdminClient, getServerSupabaseConfig } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
};

const WRITE_ROLES: AdminRole[] = ["owner", "admin", "editor"];

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function hasBearerToken(request: NextRequest) {
  return /^bearer\s+\S+/i.test(request.headers.get("authorization") || "");
}

function canWrite(role: AdminRole | null | undefined) {
  return Boolean(role && WRITE_ROLES.includes(role));
}

async function findHegOrganization(client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>) {
  return client.from("organizations").select("id,slug,name").eq("slug", "heg").maybeSingle<OrganizationRow>();
}

async function findMembership(
  client: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  user: RequestUser
) {
  const byUserId = await client
    .from("organization_members")
    .select("organization_id,user_id,email,role,is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle<AdminMembership>();

  if (byUserId.error || byUserId.data || !user.email) {
    return byUserId;
  }

  return client
    .from("organization_members")
    .select("organization_id,user_id,email,role,is_active")
    .eq("organization_id", organizationId)
    .ilike("email", user.email)
    .eq("is_active", true)
    .maybeSingle<AdminMembership>();
}

export async function GET(request: NextRequest) {
  const config = getServerSupabaseConfig();
  const client = createServerSupabaseAdminClient();

  if (!client) {
    return json(500, { success: false, error: config.issue || "Supabase server client mangler konfiguration." });
  }

  if (!hasBearerToken(request)) {
    return json(200, {
      success: true,
      loggedIn: false,
      user: null,
      organization: null,
      membership: null,
      hasWriteAccess: false
    });
  }

  const userResult = await getRequestUser(request, client);

  if ("error" in userResult) {
    return json(userResult.status, { success: false, error: userResult.error });
  }

  const organization = await findHegOrganization(client);

  if (organization.error) {
    return json(500, { success: false, error: `organizations: ${organization.error.message}` });
  }

  if (!organization.data) {
    return json(200, {
      success: true,
      loggedIn: true,
      user: userResult.user,
      organization: null,
      membership: null,
      hasWriteAccess: false,
      warning: "Organization med slug heg blev ikke fundet."
    });
  }

  const membership = await findMembership(client, organization.data.id, userResult.user);

  if (membership.error) {
    return json(500, { success: false, error: `organization_members: ${membership.error.message}` });
  }

  return json(200, {
    success: true,
    loggedIn: true,
    user: userResult.user,
    organization: organization.data,
    membership: membership.data,
    hasWriteAccess: canWrite(membership.data?.role)
  });
}

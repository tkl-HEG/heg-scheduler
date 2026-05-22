import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { changedByFromActor, createServerSupabaseAdminClient } from "./supabaseServer";

export type AdminRole = "owner" | "admin" | "editor" | "viewer";

export type RequestUser = {
  id: string;
  email: string | null;
};

export type AdminMembership = {
  organization_id: string;
  user_id: string | null;
  email: string;
  role: AdminRole;
  is_active: boolean;
};

type AuthFailure = {
  ok: false;
  status: 403 | 500;
  error: string;
};

type RequestUserSuccess = {
  ok: true;
  user: RequestUser;
};

type AdminAuthSuccess = {
  ok: true;
  user: RequestUser;
  membership: AdminMembership;
};

const WRITE_ROLES: AdminRole[] = ["owner", "admin", "editor"];

function bearerTokenFromRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function missingClientFailure(): AuthFailure {
  return {
    ok: false,
    status: 500,
    error: "Supabase server client mangler konfiguration."
  };
}

async function findMembershipByUserId(
  client: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<{ data: AdminMembership | null; error: string | null }> {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id,user_id,email,role,is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("role", WRITE_ROLES)
    .maybeSingle<AdminMembership>();

  return { data, error: error?.message || null };
}

async function findMembershipByEmail(
  client: SupabaseClient,
  organizationId: string,
  email: string
): Promise<{ data: AdminMembership | null; error: string | null }> {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id,user_id,email,role,is_active")
    .eq("organization_id", organizationId)
    .ilike("email", email)
    .eq("is_active", true)
    .in("role", WRITE_ROLES)
    .maybeSingle<AdminMembership>();

  return { data, error: error?.message || null };
}

export async function getRequestUser(
  request: NextRequest,
  client: SupabaseClient | null = createServerSupabaseAdminClient()
): Promise<RequestUserSuccess | AuthFailure> {
  if (!client) {
    return missingClientFailure();
  }

  const token = bearerTokenFromRequest(request);

  if (!token) {
    return {
      ok: false,
      status: 403,
      error: "Mangler Authorization: Bearer token."
    };
  }

  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    return {
      ok: false,
      status: 403,
      error: "Ugyldig eller udløbet Supabase Auth session."
    };
  }

  return {
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email || null
    }
  };
}

export async function assertAdminOrEditor({
  request,
  organizationId,
  client = createServerSupabaseAdminClient(),
  user
}: {
  request: NextRequest;
  organizationId: string;
  client?: SupabaseClient | null;
  user?: RequestUser;
}): Promise<AdminAuthSuccess | AuthFailure> {
  if (!client) {
    return missingClientFailure();
  }

  const userResult = user ? ({ ok: true, user } as RequestUserSuccess) : await getRequestUser(request, client);

  if ("error" in userResult) {
    return userResult;
  }

  const byUserId = await findMembershipByUserId(client, organizationId, userResult.user.id);

  if (byUserId.error) {
    return {
      ok: false,
      status: 500,
      error: `organization_members: ${byUserId.error}`
    };
  }

  let membership = byUserId.data;

  if (!membership && userResult.user.email) {
    const byEmail = await findMembershipByEmail(client, organizationId, userResult.user.email);

    if (byEmail.error) {
      return {
        ok: false,
        status: 500,
        error: `organization_members: ${byEmail.error}`
      };
    }

    membership = byEmail.data;
  }

  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "Brugeren mangler owner/admin/editor rolle for organisationen."
    };
  }

  return {
    ok: true,
    user: userResult.user,
    membership
  };
}

export function getAdminIdentityForAudit(user: RequestUser) {
  return changedByFromActor({
    userId: user.id,
    email: user.email
  });
}

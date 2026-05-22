import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServerSupabaseConfig = {
  url: string | null;
  serviceRoleKey: string | null;
  issue: string | null;
};

export type ServerEditActor = {
  userId?: string | null;
  email?: string | null;
};

export function getServerSupabaseConfig(): ServerSupabaseConfig {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return {
      url: url || null,
      serviceRoleKey: serviceRoleKey || null,
      issue: "Mangler SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY."
    };
  }

  return { url, serviceRoleKey, issue: null };
}

export function createServerSupabaseAdminClient(): SupabaseClient | null {
  const config = getServerSupabaseConfig();

  if (config.issue) {
    return null;
  }

  return createClient(config.url!, config.serviceRoleKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function changedByFromActor(actor: ServerEditActor | null | undefined) {
  if (actor?.userId) return actor.userId;
  if (actor?.email) return actor.email;
  return "server";
}

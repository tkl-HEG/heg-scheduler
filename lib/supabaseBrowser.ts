"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    return {
      url: null,
      anonKey: null,
      issue: "Mangler NEXT_PUBLIC_SUPABASE_URL eller NEXT_PUBLIC_SUPABASE_ANON_KEY."
    };
  }

  return { url, anonKey, issue: null };
}

export function createBrowserSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseBrowserConfig();

  if (config.issue) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(config.url!, config.anonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  }

  return browserClient;
}

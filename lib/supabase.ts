import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ReadResult<T> = {
  data: T[];
  issue: string | null;
};

export type CountResult = {
  value: number | null;
  issue: string | null;
};

export function getSupabaseConfig() {
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

export function createReadOnlySupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();

  if (config.issue) {
    return null;
  }

  return createClient(config.url!, config.anonKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function readRows<T>(
  table: string,
  select = "*",
  options: { order?: string; ascending?: boolean; limit?: number } = {}
): Promise<ReadResult<T>> {
  const client = createReadOnlySupabaseClient();

  if (!client) {
    return { data: [], issue: getSupabaseConfig().issue };
  }

  try {
    let query = client.from(table).select(select);

    if (options.order) {
      query = query.order(options.order, { ascending: options.ascending ?? true });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], issue: `${table}: ${error.message}` };
    }

    return { data: (data ?? []) as T[], issue: null };
  } catch (error) {
    return { data: [], issue: `${table}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function countRows(table: string): Promise<CountResult> {
  const client = createReadOnlySupabaseClient();

  if (!client) {
    return { value: null, issue: getSupabaseConfig().issue };
  }

  try {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });

    if (error) {
      return { value: null, issue: `${table}: ${error.message}` };
    }

    return { value: count ?? 0, issue: null };
  } catch (error) {
    return { value: null, issue: `${table}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

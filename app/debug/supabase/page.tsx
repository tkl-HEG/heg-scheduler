import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { formatCount } from "../../../lib/format";
import { countRows, getSupabaseConfig } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

function supabaseHost(url: string | null) {
  if (!url) {
    return "-";
  }

  try {
    return new URL(url).host;
  } catch {
    return "Ugyldig URL";
  }
}

export default async function SupabaseDebugPage() {
  const config = getSupabaseConfig();
  const [teachers, classes] = await Promise.all([countRows("teachers"), countRows("class_groups")]);
  const issues = [config.issue, teachers.issue, classes.issue].filter(Boolean) as string[];

  return (
    <>
      <PageHeader title="Supabase debug" />
      <StatusMessage issues={issues} />
      <DataTable
        columns={["Kontrol", "Resultat"]}
        rows={[
          ["URL sat", config.url ? "Ja" : "Nej"],
          ["Anon key sat", config.anonKey ? "Ja" : "Nej"],
          ["Supabase host", supabaseHost(config.url)],
          ["teachers count", formatCount(teachers.value)],
          ["class_groups count", formatCount(classes.value)]
        ]}
      />
    </>
  );
}

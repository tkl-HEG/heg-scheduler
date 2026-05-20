import { CalendarFilters } from "../../components/CalendarFilters";
import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import {
  getCalendarPresence,
  groupPresenceByWeek,
  parsePresenceFilters,
  type PresenceItem
} from "../../lib/calendarPresence";
import { asText } from "../../lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function sourceText(items: PresenceItem[]) {
  return [...new Set(items.map((item) => item.source))].join(", ");
}

function buildPresenceRows(items: PresenceItem[]) {
  const grouped = new Map<string, PresenceItem[]>();

  for (const item of items) {
    const key = `${item.className}|${item.categoryKey}|${item.programCode}|${item.campus}`;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  return [...grouped.values()].map((group) => {
    const first = group[0];
    const events = group.filter((item) => item.source !== "active_weeks");
    const blockers = group.filter(
      (item) => item.lockLevel === "hard_block" || item.lockLevel === "official" || item.isOfficial
    );

    return {
      ...first,
      activeWeek: group.some((item) => item.source === "active_weeks"),
      eventTitles: events.map((item) => item.title).join(", "),
      blockerTitles: blockers.map((item) => item.title).join(", "),
      sources: sourceText(group)
    };
  });
}

export default async function PresencePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const baseFilters = parsePresenceFilters(params, { halfYear: "all", source: "all" });
  const data = await getCalendarPresence({ ...baseFilters, week: null });
  const selectedWeek = baseFilters.week || data.weeks[0]?.weekNo || 1;
  const effectiveFilters = { ...baseFilters, week: selectedWeek };
  const week = groupPresenceByWeek(
    data.items.filter((item) => item.weekNo === selectedWeek),
    effectiveFilters.year,
    effectiveFilters.halfYear
  )[0];
  const rows = buildPresenceRows(week?.items || []);
  const staaRows = rows.filter((row) => row.isStaaReview);

  return (
    <>
      <PageHeader title="Tilstedeværelse" />
      <StatusMessage issues={data.issues} />

      <section className="info-box">
        Denne side viser hvilke hold og kalenderposter der er inde i den valgte uge. Ugeaktivitet fra
        class_active_weeks er ikke fordelt på konkrete dage.
      </section>

      <CalendarFilters filters={effectiveFilters} showSource={false} showWeek />

      <section className="content-section">
        <h2>
          Uge {selectedWeek} {week ? <span className="muted-title">{week.interval}</span> : null}
        </h2>
        <DataTable
          columns={["Hold", "Kategori", "Program", "Campus", "Aktiv uge", "Kalenderevents", "Blockers", "Kilde"]}
          rows={rows.map((row) => [
            <span key="class">
              <strong>{asText(row.className)}</strong>
              {row.isStaaReview ? <small>Mulige kohorter: {asText(row.possibleCohorts)}</small> : null}
            </span>,
            asText(row.category),
            <span key="program">
              {asText(row.program)}
              {row.combinedTeachingGroupKey ? <small>{row.combinedTeachingGroupKey}</small> : null}
            </span>,
            asText(row.campus),
            row.activeWeek ? "Ja" : "Nej",
            asText(row.eventTitles),
            asText(row.blockerTitles),
            asText(row.sources)
          ])}
        />
      </section>

      {staaRows.length ? (
        <section className="info-box">
          STÅ Aars/Hobro vises som fælles STÅ-program. Kohorten er stadig til review mellem staa1 og staa2, og
          sammenlæsning markeres med staa_combined.
        </section>
      ) : null}
    </>
  );
}

import { CalendarFilters } from "../../components/CalendarFilters";
import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { StatusMessage } from "../../components/StatusMessage";
import { getCalendarPresence, parsePresenceFilters } from "../../lib/calendarPresence";
import { asText } from "../../lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function sourceLabel(source: string) {
  if (source === "official_hf") return "official_hf_calendar_entries";
  if (source === "planning_calendar") return "planning_calendar_events";
  return "class_active_weeks";
}

function statusBadges(item: any) {
  const badges = [];

  if (item.isOfficial || item.lockLevel === "official") {
    badges.push(
      <span className="badge badge-info" key="official">
        Officiel HF
      </span>
    );
  }

  if (item.lockLevel && item.lockLevel !== "official") {
    badges.push(
      <span className={`badge badge-${item.lockLevel === "hard_block" ? "error" : "warning"}`} key="lock">
        {item.lockLevel}
      </span>
    );
  }

  if (item.eventType) {
    badges.push(
      <span className="badge" key="type">
        {item.eventType}
      </span>
    );
  }

  if (item.isStaaReview) {
    badges.push(
      <span className="badge badge-warning" key="staa">
        STÅ kohorte review
      </span>
    );
  }

  return <div className="badge-row">{badges}</div>;
}

export default async function CalendarsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = parsePresenceFilters(params);
  const { weeks, issues } = await getCalendarPresence(filters);

  return (
    <>
      <PageHeader title="Kalendere" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Denne visning viser planlagt tilstedeværelse og kalendergrundlag. Den er ikke et endeligt modulskema endnu,
        fordi lesson_bookings ikke er oprettet.
      </section>

      <CalendarFilters filters={filters} />

      <div className="group-stack">
        {weeks.map((week) => (
          <section className="group-panel" key={week.weekNo}>
            <h2>
              Uge {week.weekNo} <span>{week.interval}</span>
            </h2>
            <div className="week-summary">
              <strong>{week.items.length}</strong>
              <span>hold/events i visningen</span>
            </div>

            <div className="day-stack">
              {week.days.map((day) => (
                <section className="day-panel" key={day.key}>
                  <h3>
                    {day.label} <span>{day.items.length}</span>
                  </h3>
                  <DataTable
                    columns={["Hold/event", "Kategori/program", "Campus", "Kilde", "Tekst", "Status"]}
                    rows={day.items.map((item) => [
                      <span key="class">
                        <strong>{asText(item.className)}</strong>
                        <small>{asText(item.title)}</small>
                      </span>,
                      <span key="category">
                        {asText(item.category)}
                        <small>{asText(item.program)}</small>
                      </span>,
                      asText(item.campus),
                      sourceLabel(item.source),
                      asText(item.rawText),
                      statusBadges(item)
                    ])}
                  />
                </section>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

import type { PresenceFilters } from "../lib/calendarPresence";

const years = [2023, 2024, 2025, 2026, 2027, 2028];
const categories = [
  ["all", "Alle"],
  ["hf", "Hovedforløb"],
  ["gf1", "GF1"],
  ["gf2", "GF2"],
  ["staa", "STÅ"],
  ["brobygning", "Brobygning"],
  ["amu", "AMU"],
  ["administration", "Administration"],
  ["handel", "Handel"],
  ["logistik", "Logistik"],
  ["detail", "Detail"],
  ["detail_ikea", "Detail IKEA"]
];
const campuses = [
  ["all", "Alle"],
  ["Aars", "Aars"],
  ["Hobro", "Hobro"]
];
const sources = [
  ["all", "Alle"],
  ["official_hf", "Officiel HF"],
  ["planning_calendar", "Planlægningskalender"],
  ["active_weeks", "Aktive uger"]
];

export function CalendarFilters({
  filters,
  showSource = true,
  showWeek = false
}: {
  filters: PresenceFilters;
  showSource?: boolean;
  showWeek?: boolean;
}) {
  return (
    <form className="filter-bar" method="get">
      <label>
        År
        <select name="year" defaultValue={filters.year}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>

      {showWeek ? (
        <label>
          Uge
          <input name="week" type="number" min="1" max="53" defaultValue={filters.week || ""} />
        </label>
      ) : (
        <label>
          Halvår
          <select name="halfYear" defaultValue={filters.halfYear}>
            <option value="all">Hele året</option>
            <option value="H1">H1</option>
            <option value="H2">H2</option>
          </select>
        </label>
      )}

      <label>
        Kategori
        <select name="category" defaultValue={filters.category}>
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Campus
        <select name="campus" defaultValue={filters.campus}>
          {campuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {showSource ? (
        <label>
          Kilde
          <select name="source" defaultValue={filters.source}>
            {sources.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="submit">Vis</button>
    </form>
  );
}

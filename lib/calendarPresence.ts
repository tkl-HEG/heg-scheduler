import { readRows } from "./supabase";

type Row = Record<string, any>;

export type PresenceSource = "official_hf" | "planning_calendar" | "active_weeks";

export type PresenceFilters = {
  year: number;
  halfYear: "all" | "H1" | "H2";
  category: string;
  campus: string;
  source: "all" | PresenceSource;
  week?: number | null;
};

export type PresenceItem = {
  id: string;
  source: PresenceSource;
  weekNo: number;
  dayKey: string;
  date: string | null;
  weekday: string;
  title: string;
  className: string;
  category: string;
  categoryKey: string;
  program: string;
  programCode: string;
  campus: string;
  rawText: string | null;
  eventType: string | null;
  lockLevel: string | null;
  isOfficial: boolean;
  isStaaReview: boolean;
  possibleCohorts: string[];
  combinedTeachingGroupKey: string | null;
};

export type WeekPresence = {
  weekNo: number;
  interval: string;
  items: PresenceItem[];
  days: { key: string; label: string; date: string | null; items: PresenceItem[] }[];
};

const dayNames = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
const shortDayNames = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

function issuesFrom(results: { issue: string | null }[]) {
  return [...new Set(results.map((result) => result.issue).filter(Boolean) as string[])];
}

function mapById(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isoWeekStart(year: number, weekNo: number) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const day = januaryFourth.getUTCDay() || 7;
  const weekOneMonday = addDays(januaryFourth, 1 - day);
  return addDays(weekOneMonday, (weekNo - 1) * 7);
}

export function isoWeekInterval(year: number, weekNo: number) {
  const start = isoWeekStart(year, weekNo);
  const end = addDays(start, 6);
  return `${formatDanishDate(toDateKey(start))} - ${formatDanishDate(toDateKey(end))}`;
}

function formatDanishDate(dateKey: string | null) {
  if (!dateKey) {
    return "-";
  }

  return new Intl.DateTimeFormat("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

function isoWeekFromDate(dateKey: string | null, fallback?: number | null) {
  if (!dateKey) {
    return fallback || null;
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const target = new Date(date);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function yearFromDate(dateKey: string | null) {
  return dateKey ? Number(dateKey.slice(0, 4)) : null;
}

function halfYearFromDate(dateKey: string | null, weekNo: number | null) {
  if (dateKey) {
    return Number(dateKey.slice(5, 7)) <= 6 ? "H1" : "H2";
  }

  if (!weekNo) {
    return "all";
  }

  return weekNo <= 26 ? "H1" : "H2";
}

function weekdayFromDate(dateKey: string | null) {
  if (!dateKey) {
    return "Hele ugen";
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const index = (date.getUTCDay() + 6) % 7;
  return dayNames[index] || "Dag";
}

function dayKeyFromDate(dateKey: string | null) {
  if (!dateKey) {
    return "week";
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const index = (date.getUTCDay() + 6) % 7;
  return String(index + 1);
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inferOfficialCategory(entry: Row) {
  const text = normalize(`${entry.course_category || ""} ${entry.course_name || ""} ${entry.raw_text || ""}`);

  if (text.includes("ikea")) return { key: "detail_ikea", label: "IKEA detail" };
  if (text.includes("log")) return { key: "logistik", label: "Logistik" };
  if (text.includes("handel")) return { key: "handel", label: "Handel" };
  if (text.includes("adm") || text.includes("kontor") || text.includes("okonomi")) {
    return { key: "administration", label: "Administration" };
  }
  if (text.includes("detail") || text.includes("salgs") || text.includes("kap")) {
    return { key: "detail", label: "Detail" };
  }

  return { key: "hf", label: entry.course_category || "Hovedforløb" };
}

function categoryFilterMatches(filter: string, categoryKey: string, source: PresenceSource) {
  if (filter === "all") return true;
  if (filter === "hf") {
    return source === "official_hf" || ["detail", "detail_ikea", "logistik", "administration", "handel"].includes(categoryKey);
  }
  if (filter === "brobygning") {
    return categoryKey.includes("klasse") || categoryKey.includes("brobyg") || categoryKey === "ovrig";
  }
  return categoryKey === filter;
}

function sourceFilterMatches(filter: PresenceFilters["source"], source: PresenceSource) {
  return filter === "all" || filter === source;
}

function campusFilterMatches(filter: string, campus: string) {
  return filter === "all" || normalize(campus) === normalize(filter);
}

function itemMatchesFilters(item: PresenceItem, filters: PresenceFilters) {
  if (!sourceFilterMatches(filters.source, item.source)) return false;
  if (!categoryFilterMatches(filters.category, item.categoryKey, item.source)) return false;
  if (!campusFilterMatches(filters.campus, item.campus)) return false;
  if (filters.week && item.weekNo !== filters.week) return false;

  const itemHalfYear = halfYearFromDate(item.date, item.weekNo);
  if (filters.halfYear !== "all" && itemHalfYear !== filters.halfYear) return false;

  return true;
}

function classCategoryKey(category: Row | undefined, klass: Row) {
  return normalize(category?.normalized_key || category?.name || klass.metadata?.possible_category_keys?.[0] || klass.metadata?.possible_category);
}

function classProgramCode(program: Row | undefined, klass: Row) {
  return String(program?.code || klass.metadata?.common_education_program_code || "");
}

function staaFields(klass: Row) {
  return {
    isStaaReview: normalize(klass.name).includes("studenter") || normalize(klass.metadata?.common_education_program_code) === "staa",
    possibleCohorts: klass.metadata?.possible_cohort_types || [],
    combinedTeachingGroupKey: klass.metadata?.combined_teaching_group_key || null
  };
}

export async function getCalendarPresence(filters: PresenceFilters) {
  const [classes, activeWeeks, categories, programs, campuses, officialEntries, planningEvents] = await Promise.all([
    readRows<Row>(
      "class_groups",
      "id,legacy_id,name,address_label,campus_id,class_category_id,education_program_id,metadata",
      { order: "name", limit: 1000 }
    ),
    readRows<Row>("class_active_weeks", "class_group_id,week_no", { limit: 5000 }),
    readRows<Row>("class_categories", "id,name,normalized_key", { limit: 1000 }),
    readRows<Row>("education_programs", "id,code,name", { limit: 1000 }),
    readRows<Row>("campuses", "id,name,legacy_label", { limit: 500 }),
    readRows<Row>(
      "official_hf_calendar_entries",
      "id,calendar_year,date,iso_week,weekday,raw_text,course_name,course_category,teacher_initials,is_exam_or_project,is_opsamling,is_reserved_or_blocked,lock_level",
      { order: "date", limit: 5000 }
    ),
    readRows<Row>(
      "planning_calendar_events",
      "id,source_type,date,end_date,iso_week,weekday,title,raw_text,event_type,lock_level,applies_to,teacher_initials,class_group_id,class_category_id,education_program_id,metadata",
      { order: "date", limit: 5000 }
    )
  ]);

  const classMap = mapById(classes.data);
  const categoryMap = mapById(categories.data);
  const programMap = mapById(programs.data);
  const campusMap = mapById(campuses.data);
  const items: PresenceItem[] = [];

  for (const entry of officialEntries.data) {
    const year = yearFromDate(entry.date) || Number(entry.calendar_year);
    const weekNo = Number(entry.iso_week || isoWeekFromDate(entry.date));

    if (year !== filters.year || !weekNo) continue;

    const category = inferOfficialCategory(entry);
    const item: PresenceItem = {
      id: `official-${entry.id}`,
      source: "official_hf",
      weekNo,
      dayKey: dayKeyFromDate(entry.date),
      date: entry.date || null,
      weekday: entry.weekday || weekdayFromDate(entry.date),
      title: entry.course_name || entry.course_category || "Hovedforløb",
      className: entry.course_category ? `Hovedforløb: ${entry.course_category}` : "Hovedforløb",
      category: category.label,
      categoryKey: category.key,
      program: "Officiel hovedforløbskalender",
      programCode: "official_hf",
      campus: "Ikke angivet",
      rawText: entry.raw_text,
      eventType: entry.is_exam_or_project ? "exam_or_project" : null,
      lockLevel: entry.lock_level || "official",
      isOfficial: true,
      isStaaReview: false,
      possibleCohorts: [],
      combinedTeachingGroupKey: null
    };

    if (itemMatchesFilters(item, filters)) items.push(item);
  }

  for (const event of planningEvents.data) {
    const year = yearFromDate(event.date) || filters.year;
    const weekNo = Number(event.iso_week || isoWeekFromDate(event.date));

    if (year !== filters.year || !weekNo) continue;

    const klass = event.class_group_id ? classMap.get(event.class_group_id) : null;
    const category = event.class_category_id ? categoryMap.get(event.class_category_id) : null;
    const program = event.education_program_id ? programMap.get(event.education_program_id) : null;
    const campus = klass?.campus_id ? campusMap.get(klass.campus_id) : null;
    const categoryKey = normalize(
      category?.normalized_key ||
        category?.name ||
        event.applies_to?.[0] ||
        event.source_type?.replace("_calendar", "") ||
        "info"
    );
    const staa = klass ? staaFields(klass) : { isStaaReview: categoryKey === "staa", possibleCohorts: [], combinedTeachingGroupKey: null };

    const item: PresenceItem = {
      id: `planning-${event.id}`,
      source: "planning_calendar",
      weekNo,
      dayKey: dayKeyFromDate(event.date),
      date: event.date || null,
      weekday: event.weekday || weekdayFromDate(event.date),
      title: event.title,
      className: klass?.name || event.applies_to?.join(", ") || event.title,
      category: category?.name || event.applies_to?.join(", ") || event.source_type,
      categoryKey,
      program: program?.name || event.source_type,
      programCode: program?.code || event.source_type,
      campus: campus?.name || klass?.address_label || "Ikke angivet",
      rawText: event.raw_text,
      eventType: event.event_type,
      lockLevel: event.lock_level,
      isOfficial: false,
      ...staa
    };

    if (itemMatchesFilters(item, filters)) items.push(item);
  }

  for (const activeWeek of activeWeeks.data) {
    const weekNo = Number(activeWeek.week_no);
    const klass = classMap.get(activeWeek.class_group_id);
    if (!klass || !weekNo) continue;

    const category = categoryMap.get(klass.class_category_id);
    const program = programMap.get(klass.education_program_id);
    const campus = campusMap.get(klass.campus_id);
    const categoryKey = classCategoryKey(category, klass);
    const staa = staaFields(klass);
    const item: PresenceItem = {
      id: `active-${klass.id}-${weekNo}`,
      source: "active_weeks",
      weekNo,
      dayKey: "week",
      date: null,
      weekday: "Hele ugen",
      title: "Aktiv uge",
      className: klass.name,
      category: category?.name || klass.metadata?.possible_category || "Ukendt",
      categoryKey,
      program: program?.name || klass.metadata?.common_education_program_code || "Ukendt",
      programCode: classProgramCode(program, klass),
      campus: campus?.name || klass.address_label || "Ikke angivet",
      rawText: null,
      eventType: "active_week",
      lockLevel: null,
      isOfficial: false,
      ...staa
    };

    if (itemMatchesFilters(item, filters)) items.push(item);
  }

  const weeks = groupPresenceByWeek(items, filters.year, filters.halfYear);

  return {
    items,
    weeks,
    issues: issuesFrom([classes, activeWeeks, categories, programs, campuses, officialEntries, planningEvents])
  };
}

export function groupPresenceByWeek(items: PresenceItem[], year: number, halfYear: PresenceFilters["halfYear"]) {
  const weekNumbers = [...new Set(items.map((item) => item.weekNo))]
    .filter((weekNo) => halfYear === "all" || (halfYear === "H1" ? weekNo <= 26 : weekNo >= 27))
    .sort((a, b) => a - b);

  return weekNumbers.map<WeekPresence>((weekNo) => {
    const weekItems = items
      .filter((item) => item.weekNo === weekNo)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.className.localeCompare(b.className, "da"));
    const monday = isoWeekStart(year, weekNo);
    const dayGroups = [
      {
        key: "week",
        label: "Hele ugen",
        date: null,
        items: weekItems.filter((item) => item.dayKey === "week")
      },
      ...dayNames.map((label, index) => {
        const date = toDateKey(addDays(monday, index));
        return {
          key: String(index + 1),
          label: `${shortDayNames[index]} ${formatDanishDate(date)}`,
          date,
          items: weekItems.filter((item) => item.dayKey === String(index + 1))
        };
      })
    ].filter((group) => group.items.length);

    return {
      weekNo,
      interval: isoWeekInterval(year, weekNo),
      items: weekItems,
      days: dayGroups
    };
  });
}

export function parsePresenceFilters(params: Record<string, string | string[] | undefined>, defaults: Partial<PresenceFilters> = {}) {
  const now = new Date();
  const year = Number(valueOf(params.year)) || defaults.year || now.getFullYear();
  const week = Number(valueOf(params.week)) || defaults.week || null;
  const halfYear = ["H1", "H2", "all"].includes(valueOf(params.halfYear) || "")
    ? (valueOf(params.halfYear) as PresenceFilters["halfYear"])
    : defaults.halfYear || "all";
  const source = ["official_hf", "planning_calendar", "active_weeks", "all"].includes(valueOf(params.source) || "")
    ? (valueOf(params.source) as PresenceFilters["source"])
    : defaults.source || "all";

  return {
    year,
    week,
    halfYear,
    source,
    category: valueOf(params.category) || defaults.category || "all",
    campus: valueOf(params.campus) || defaults.campus || "all"
  };
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

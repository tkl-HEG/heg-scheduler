export function formatCount(value: number | null) {
  return value === null ? " -" : new Intl.NumberFormat("da-DK").format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

export function asText(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : fallback;
  }

  return String(value);
}

export function weekSummary(weeks: number[]) {
  if (!weeks.length) {
    return { count: 0, range: "-" };
  }

  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  return {
    count: sorted.length,
    range: `${sorted[0]}-${sorted[sorted.length - 1]}`
  };
}

export function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || "Ukendt";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export function sortGroupedCounts(groups: Record<string, number>) {
  return Object.entries(groups).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da"));
}

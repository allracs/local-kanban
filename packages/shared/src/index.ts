export interface Card {
  id: string;
  title: string;
  column: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export type GroupBy = "none" | "scheduled" | "completed";

export interface Column {
  name: string;
  cardIds: string[];
  groupBy: GroupBy;
}

export interface DayGroup {
  key: string;        // "all" | "overdue" | "today" | "tomorrow" | "yesterday" | "unscheduled" | "undated" | "YYYY-MM-DD"
  label: string;      // "" for ungrouped; otherwise "Today", "Tomorrow", "Sun May 31", ...
  droppable: boolean; // can a card be dropped here to (re)schedule it?
  cardIds: string[];
}

export interface BoardState {
  projectName: string;
  columns: Column[];
  cards: Record<string, Card>;
}

export type WSMessage =
  | { type: "board:update"; state: BoardState }
  | { type: "error"; message: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a local YYYY-MM-DD into a local Date (avoids UTC shift of `new Date(str)`).
function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s: string, n: number): string {
  const d = parseLocal(s);
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

function dateLabel(s: string): string {
  const d = parseLocal(s);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

interface CardLike {
  id: string;
  frontmatter: Record<string, unknown>;
}

export function computeDayGroups(
  cards: CardLike[],
  mode: GroupBy,
  today: string
): DayGroup[] {
  if (mode === "none") {
    return [{ key: "all", label: "", droppable: true, cardIds: cards.map((c) => c.id) }];
  }

  const field = mode === "scheduled" ? "scheduled" : "completed";
  const dateOf = (c: CardLike): string | null => {
    const v = c.frontmatter?.[field];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  // Collect card ids per date key, preserving input order.
  const byKey = new Map<string, string[]>();
  const push = (key: string, id: string) => {
    const arr = byKey.get(key) ?? [];
    arr.push(id);
    byKey.set(key, arr);
  };

  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);

  if (mode === "scheduled") {
    for (const c of cards) {
      const d = dateOf(c);
      if (d === null) push("unscheduled", c.id);
      else if (d < today) push("overdue", c.id);
      else if (d === today) push("today", c.id);
      else if (d === tomorrow) push("tomorrow", c.id);
      else push(d, c.id); // future dated
    }
    const groups: DayGroup[] = [];
    if (byKey.has("overdue")) groups.push({ key: "overdue", label: "Overdue", droppable: false, cardIds: byKey.get("overdue")! });
    groups.push({ key: "today", label: "Today", droppable: true, cardIds: byKey.get("today") ?? [] });
    groups.push({ key: "tomorrow", label: "Tomorrow", droppable: true, cardIds: byKey.get("tomorrow") ?? [] });
    const futureDates = [...byKey.keys()].filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k > tomorrow).sort();
    for (const k of futureDates) groups.push({ key: k, label: dateLabel(k), droppable: true, cardIds: byKey.get(k)! });
    if (byKey.has("unscheduled")) groups.push({ key: "unscheduled", label: "Unscheduled", droppable: true, cardIds: byKey.get("unscheduled")! });
    return groups;
  }

  // completed mode
  for (const c of cards) {
    const d = dateOf(c);
    if (d === null) push("undated", c.id);
    else if (d === today) push("today", c.id);
    else if (d === yesterday) push("yesterday", c.id);
    else push(d, c.id);
  }
  const groups: DayGroup[] = [];
  if (byKey.has("today")) groups.push({ key: "today", label: "Today", droppable: false, cardIds: byKey.get("today")! });
  if (byKey.has("yesterday")) groups.push({ key: "yesterday", label: "Yesterday", droppable: false, cardIds: byKey.get("yesterday")! });
  const pastDates = [...byKey.keys()].filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k !== today && k !== yesterday).sort().reverse();
  for (const k of pastDates) groups.push({ key: k, label: dateLabel(k), droppable: false, cardIds: byKey.get(k)! });
  if (byKey.has("undated")) groups.push({ key: "undated", label: "No date", droppable: false, cardIds: byKey.get("undated")! });
  return groups;
}

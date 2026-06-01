import { computeDayGroups, localDateString } from "@kanban/shared";

type C = { id: string; frontmatter: Record<string, unknown> };
const card = (id: string, fm: Record<string, unknown> = {}): C => ({ id, frontmatter: fm });

describe("localDateString", () => {
  it("formats a Date as local YYYY-MM-DD", () => {
    expect(localDateString(new Date(2026, 4, 29))).toBe("2026-05-29"); // month is 0-based
  });
});

describe("computeDayGroups - none", () => {
  it("returns a single ungrouped bucket", () => {
    const groups = computeDayGroups([card("a"), card("b")], "none", "2026-05-29");
    expect(groups).toEqual([
      { key: "all", label: "", droppable: true, cardIds: ["a", "b"] },
    ]);
  });
});

describe("computeDayGroups - scheduled", () => {
  const today = "2026-05-29";
  it("always shows Today and Tomorrow even when empty", () => {
    const groups = computeDayGroups([], "scheduled", today);
    expect(groups.map((g) => g.key)).toEqual(["today", "tomorrow"]);
    expect(groups.every((g) => g.droppable)).toBe(true);
  });

  it("buckets overdue, today, tomorrow, future, unscheduled in order", () => {
    const cards = [
      card("future", { scheduled: "2026-05-31" }),
      card("today1", { scheduled: "2026-05-29" }),
      card("none1", {}),
      card("over1", { scheduled: "2026-05-20" }),
      card("tom1", { scheduled: "2026-05-30" }),
    ];
    const groups = computeDayGroups(cards, "scheduled", today);
    expect(groups.map((g) => g.key)).toEqual([
      "overdue", "today", "tomorrow", "2026-05-31", "unscheduled",
    ]);
    expect(groups.find((g) => g.key === "overdue")!.cardIds).toEqual(["over1"]);
    expect(groups.find((g) => g.key === "today")!.cardIds).toEqual(["today1"]);
    expect(groups.find((g) => g.key === "tomorrow")!.cardIds).toEqual(["tom1"]);
    expect(groups.find((g) => g.key === "2026-05-31")!.cardIds).toEqual(["future"]);
    expect(groups.find((g) => g.key === "unscheduled")!.cardIds).toEqual(["none1"]);
    // Overdue is display-only; future dated + today/tomorrow/unscheduled are droppable
    expect(groups.find((g) => g.key === "overdue")!.droppable).toBe(false);
    expect(groups.find((g) => g.key === "2026-05-31")!.droppable).toBe(true);
    // Future group label is human-readable
    expect(groups.find((g) => g.key === "2026-05-31")!.label).toBe("Sun May 31");
  });

  it("preserves incoming card order within a group", () => {
    const cards = [card("b", { scheduled: today }), card("a", { scheduled: today })];
    const groups = computeDayGroups(cards, "scheduled", today);
    expect(groups.find((g) => g.key === "today")!.cardIds).toEqual(["b", "a"]);
  });
});

describe("computeDayGroups - completed", () => {
  const today = "2026-05-29";

  it("always shows a droppable Today so cards can be moved into Done", () => {
    const groups = computeDayGroups([], "completed", today);
    expect(groups.map((g) => g.key)).toEqual(["today"]);
    expect(groups[0].droppable).toBe(true);
  });

  it("shows non-empty groups most-recent first, undated last; only Today droppable", () => {
    const cards = [
      card("old", { completed: "2026-05-27" }),
      card("done1", { completed: "2026-05-29" }),
      card("yest", { completed: "2026-05-28" }),
      card("nodate", {}),
    ];
    const groups = computeDayGroups(cards, "completed", today);
    expect(groups.map((g) => g.key)).toEqual([
      "today", "yesterday", "2026-05-27", "undated",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Today", "Yesterday", "Wed May 27", "No date",
    ]);
    // Today accepts drops (completing a card stamps today); the rest are display-only.
    expect(groups.find((g) => g.key === "today")!.droppable).toBe(true);
    expect(groups.filter((g) => g.key !== "today").every((g) => g.droppable === false)).toBe(true);
  });
});

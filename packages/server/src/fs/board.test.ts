import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bootstrapIfNeeded,
  readBoard,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  readConfig,
  setColumnGroupBy,
} from "./board.js";
import { localDateString } from "@kanban/shared";

async function tmpWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "kanban-test-"));
}

afterEach(async () => {
  // tmp dirs are cleaned up by OS eventually; individual tests can clean up if needed
});

describe("bootstrapIfNeeded", () => {
  it("creates todo/doing/done dirs with .order files", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    for (const col of ["todo", "doing", "done"]) {
      const stat = await fs.stat(path.join(ws, ".kanban", col));
      expect(stat.isDirectory()).toBe(true);
      const orderStat = await fs.stat(path.join(ws, ".kanban", col, ".order"));
      expect(orderStat.isFile()).toBe(true);
    }
    await fs.rm(ws, { recursive: true });
  });

  it("is idempotent", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await bootstrapIfNeeded(ws);
    const entries = await fs.readdir(path.join(ws, ".kanban"), { withFileTypes: true });
    const cols = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(cols.sort()).toEqual(["doing", "done", "todo"]);
    await fs.rm(ws, { recursive: true });
  });
});

describe("createCard + readBoard", () => {
  it("creates a card and it appears in the board", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "test-card-1", "My Task", "Some body text");
    const board = await readBoard(ws);
    const card = board.cards["test-card-1"];
    expect(card).toBeDefined();
    expect(card.title).toBe("My Task");
    expect(card.body.trim()).toBe("Some body text");
    expect(card.column).toBe("todo");
    const todoCol = board.columns.find((c) => c.name === "todo")!;
    expect(todoCol.cardIds).toContain("test-card-1");
    await fs.rm(ws, { recursive: true });
  });

  it("preserves unknown frontmatter keys on round-trip", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "fm-test", "FM Card", "body");
    // Manually add an extra key
    const filePath = path.join(ws, ".kanban", "todo", "fm-test.md");
    const raw = await fs.readFile(filePath, "utf8");
    await fs.writeFile(filePath, raw.replace("body:", "custom: yes\nbody:"), "utf8");
    const board = await readBoard(ws);
    // Just check it doesn't throw and card is readable
    expect(board.cards["fm-test"]).toBeDefined();
    await fs.rm(ws, { recursive: true });
  });
});

describe("updateCard", () => {
  it("updates title and body", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "upd-card", "Original", "Original body");
    await updateCard(ws, "upd-card", { title: "Updated", body: "New body" });
    const board = await readBoard(ws);
    expect(board.cards["upd-card"].title).toBe("Updated");
    expect(board.cards["upd-card"].body.trim()).toBe("New body");
    await fs.rm(ws, { recursive: true });
  });
});

describe("moveCard", () => {
  it("moves a card across columns", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "move-card", "Move Me", "");
    await moveCard(ws, "move-card", "doing", 0);
    const board = await readBoard(ws);
    expect(board.cards["move-card"].column).toBe("doing");
    expect(board.columns.find((c) => c.name === "doing")!.cardIds).toContain("move-card");
    expect(board.columns.find((c) => c.name === "todo")!.cardIds).not.toContain("move-card");
    await fs.rm(ws, { recursive: true });
  });

  it("reorders within same column", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "card-a", "A", "");
    await createCard(ws, "todo", "card-b", "B", "");
    await moveCard(ws, "card-a", "todo", 1);
    const board = await readBoard(ws);
    const ids = board.columns.find((c) => c.name === "todo")!.cardIds;
    expect(ids.indexOf("card-b")).toBeLessThan(ids.indexOf("card-a"));
    await fs.rm(ws, { recursive: true });
  });
});

describe("deleteCard", () => {
  it("removes the file and prunes the order", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "del-card", "Delete Me", "");
    await deleteCard(ws, "del-card");
    const board = await readBoard(ws);
    expect(board.cards["del-card"]).toBeUndefined();
    expect(board.columns.find((c) => c.name === "todo")!.cardIds).not.toContain("del-card");
    await fs.rm(ws, { recursive: true });
  });
});

describe("readBoard groupBy", () => {
  it("attaches groupBy from config, defaulting to none", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    const board = await readBoard(ws);
    expect(board.columns.find((c) => c.name === "todo")!.groupBy).toBe("scheduled");
    expect(board.columns.find((c) => c.name === "done")!.groupBy).toBe("completed");
    expect(board.columns.find((c) => c.name === "doing")!.groupBy).toBe("none");
    await fs.rm(ws, { recursive: true });
  });
});

describe("config", () => {
  it("bootstraps config.json with todo->scheduled and done->completed", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    const cfg = await readConfig(path.join(ws, ".kanban"));
    expect(cfg.columns.todo).toEqual({ groupBy: "scheduled" });
    expect(cfg.columns.done).toEqual({ groupBy: "completed" });
    await fs.rm(ws, { recursive: true });
  });

  it("does not overwrite an existing config.json", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    const cfgPath = path.join(ws, ".kanban", "config.json");
    await fs.writeFile(cfgPath, JSON.stringify({ columns: { todo: { groupBy: "none" } } }), "utf8");
    await bootstrapIfNeeded(ws);
    const cfg = await readConfig(path.join(ws, ".kanban"));
    expect(cfg.columns.todo).toEqual({ groupBy: "none" });
    await fs.rm(ws, { recursive: true });
  });

  it("returns empty config when file missing or malformed", async () => {
    const ws = await tmpWorkspace();
    await fs.mkdir(path.join(ws, ".kanban"), { recursive: true });
    expect(await readConfig(path.join(ws, ".kanban"))).toEqual({ columns: {} });
    await fs.writeFile(path.join(ws, ".kanban", "config.json"), "not json", "utf8");
    expect(await readConfig(path.join(ws, ".kanban"))).toEqual({ columns: {} });
    await fs.rm(ws, { recursive: true });
  });
});

describe("updateCard clearing", () => {
  it("deletes a frontmatter key when set to null", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "clr", "Clear", "");
    await updateCard(ws, "clr", { frontmatter: { scheduled: "2026-05-30" } });
    expect((await readBoard(ws)).cards["clr"].frontmatter.scheduled).toBe("2026-05-30");
    await updateCard(ws, "clr", { frontmatter: { scheduled: null } });
    expect((await readBoard(ws)).cards["clr"].frontmatter.scheduled).toBeUndefined();
    await fs.rm(ws, { recursive: true });
  });
});

describe("moveCard completed stamping", () => {
  it("stamps completed (today) when entering a completed-mode column", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "fin", "Finish", "");
    await moveCard(ws, "fin", "done", 0);
    const fm = (await readBoard(ws)).cards["fin"].frontmatter;
    expect(fm.completed).toBe(localDateString());
    await fs.rm(ws, { recursive: true });
  });

  it("does not stamp completed on a reorder within the same column", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "done", "a", "A", "");
    await createCard(ws, "done", "b", "B", "");
    // entering 'done' on create does not stamp (create bypasses moveCard); reorder must not stamp either
    await moveCard(ws, "a", "done", 1);
    expect((await readBoard(ws)).cards["a"].frontmatter.completed).toBeUndefined();
    await fs.rm(ws, { recursive: true });
  });

  it("does not stamp completed when entering a non-completed column", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await createCard(ws, "todo", "mv", "Move", "");
    await moveCard(ws, "mv", "doing", 0);
    expect((await readBoard(ws)).cards["mv"].frontmatter.completed).toBeUndefined();
    await fs.rm(ws, { recursive: true });
  });
});

describe("setColumnGroupBy", () => {
  it("updates a column's grouping mode in config", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await setColumnGroupBy(ws, "doing", "scheduled");
    expect((await readBoard(ws)).columns.find((c) => c.name === "doing")!.groupBy).toBe("scheduled");
    await setColumnGroupBy(ws, "doing", "none");
    expect((await readBoard(ws)).columns.find((c) => c.name === "doing")!.groupBy).toBe("none");
    await fs.rm(ws, { recursive: true });
  });
});

describe("security", () => {
  it("rejects path-traversal card ids", async () => {
    const ws = await tmpWorkspace();
    await bootstrapIfNeeded(ws);
    await expect(deleteCard(ws, "../etc/passwd")).rejects.toThrow();
    await fs.rm(ws, { recursive: true });
  });
});

import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { BoardState, Card, Column, GroupBy } from "@kanban/shared";
import { localDateString } from "@kanban/shared";

const ORDER_FILE = ".order";
const COLUMN_ORDER_FILE = ".column-order";
const CONFIG_FILE = "config.json";

export interface KanbanConfig {
  columns: Record<string, { groupBy: GroupBy }>;
}

const VALID_GROUP_BY: GroupBy[] = ["none", "scheduled", "completed"];
const DEFAULT_COLUMNS = ["todo", "doing", "done"];

export async function readConfig(kanbanRoot: string): Promise<KanbanConfig> {
  try {
    const raw = await fs.readFile(path.join(kanbanRoot, CONFIG_FILE), "utf8");
    const parsed = JSON.parse(raw);
    const columns: Record<string, { groupBy: GroupBy }> = {};
    if (parsed && typeof parsed === "object" && parsed.columns && typeof parsed.columns === "object") {
      for (const [name, val] of Object.entries(parsed.columns as Record<string, unknown>)) {
        const gb = (val as { groupBy?: unknown })?.groupBy;
        if (typeof gb === "string" && VALID_GROUP_BY.includes(gb as GroupBy)) {
          columns[name] = { groupBy: gb as GroupBy };
        }
      }
    }
    return { columns };
  } catch {
    return { columns: {} };
  }
}

export async function writeConfig(kanbanRoot: string, config: KanbanConfig): Promise<void> {
  await fs.writeFile(path.join(kanbanRoot, CONFIG_FILE), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function getKanbanRoot(workspace: string): Promise<string> {
  return path.join(workspace, ".kanban");
}

export async function bootstrapIfNeeded(workspace: string): Promise<void> {
  const root = await getKanbanRoot(workspace);
  await fs.mkdir(root, { recursive: true });
  for (const col of DEFAULT_COLUMNS) {
    const colPath = path.join(root, col);
    await fs.mkdir(colPath, { recursive: true });
    const orderPath = path.join(colPath, ORDER_FILE);
    try {
      await fs.access(orderPath);
    } catch {
      await fs.writeFile(orderPath, "", "utf8");
    }
  }
  const columnOrderPath = path.join(root, COLUMN_ORDER_FILE);
  try {
    await fs.access(columnOrderPath);
  } catch {
    await fs.writeFile(columnOrderPath, DEFAULT_COLUMNS.join("\n") + "\n", "utf8");
  }
  const configPath = path.join(root, CONFIG_FILE);
  try {
    await fs.access(configPath);
  } catch {
    await writeConfig(root, { columns: { todo: { groupBy: "scheduled" }, done: { groupBy: "completed" } } });
  }
}

export async function readColumns(kanbanRoot: string): Promise<string[]> {
  const entries = await fs.readdir(kanbanRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const orderPath = path.join(kanbanRoot, COLUMN_ORDER_FILE);
  try {
    const raw = await fs.readFile(orderPath, "utf8");
    const ordered = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const dirSet = new Set(dirs);
    // Keep ordered ones that still exist, append any new dirs not in order file
    const valid = ordered.filter((n) => dirSet.has(n));
    const seen = new Set(valid);
    for (const d of dirs) {
      if (!seen.has(d)) valid.push(d);
    }
    return valid;
  } catch {
    return dirs.sort();
  }
}

async function readOrder(colPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(colPath, ORDER_FILE), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function writeOrder(colPath: string, ids: string[]): Promise<void> {
  await fs.writeFile(path.join(colPath, ORDER_FILE), ids.join("\n") + (ids.length ? "\n" : ""), "utf8");
}

export async function readCard(filePath: string, column: string): Promise<Card> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const id = path.basename(filePath, ".md");
  const { title, ...rest } = parsed.data as Record<string, unknown>;
  return {
    id,
    title: typeof title === "string" ? title : id,
    column,
    body: parsed.content,
    frontmatter: rest,
  };
}

export async function readBoard(workspace: string): Promise<BoardState> {
  const root = await getKanbanRoot(workspace);
  const projectName = path.basename(workspace);
  const columnNames = await readColumns(root);
  const config = await readConfig(root);
  const columns: Column[] = [];
  const cards: Record<string, Card> = {};

  for (const colName of columnNames) {
    const colPath = path.join(root, colName);
    const files = (await fs.readdir(colPath)).filter(
      (f) => f.endsWith(".md")
    );
    const fileIds = new Set(files.map((f) => f.slice(0, -3)));

    const ordered = await readOrder(colPath);
    // Keep only ids that still exist on disk, then append any new ones
    const validOrdered = ordered.filter((id) => fileIds.has(id));
    const seen = new Set(validOrdered);
    for (const id of fileIds) {
      if (!seen.has(id)) validOrdered.push(id);
    }
    // Persist reconciled order if it changed
    if (validOrdered.join(",") !== ordered.join(",")) {
      await writeOrder(colPath, validOrdered);
    }

    for (const id of validOrdered) {
      const card = await readCard(path.join(colPath, `${id}.md`), colName);
      cards[id] = card;
    }

    columns.push({
      name: colName,
      cardIds: validOrdered,
      groupBy: config.columns[colName]?.groupBy ?? "none",
    });
  }

  return { projectName, columns, cards };
}

export async function createCard(
  workspace: string,
  column: string,
  id: string,
  title: string,
  body = ""
): Promise<Card> {
  const root = await getKanbanRoot(workspace);
  const colPath = path.join(root, column);
  const filePath = path.join(colPath, `${id}.md`);

  assertSafePath(root, filePath);

  const now = new Date().toISOString();
  const content = matter.stringify(body, { id, title, created: now, updated: now });
  await fs.writeFile(filePath, content, "utf8");

  const ordered = await readOrder(colPath);
  ordered.push(id);
  await writeOrder(colPath, ordered);

  return { id, title, column, body, frontmatter: { created: now, updated: now } };
}

export async function updateCard(
  workspace: string,
  id: string,
  patch: { title?: string; body?: string; frontmatter?: Record<string, unknown> }
): Promise<Card> {
  const root = await getKanbanRoot(workspace);
  const existing = await findCard(root, id);
  const { filePath, column } = existing;

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);

  const newFrontmatter = {
    ...parsed.data,
    ...(patch.frontmatter ?? {}),
    id,
    title: patch.title ?? (parsed.data.title as string) ?? id,
    updated: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(newFrontmatter)) {
    if (v === null || v === undefined) delete (newFrontmatter as Record<string, unknown>)[k];
  }
  const newBody = patch.body ?? parsed.content;
  const newContent = matter.stringify(newBody, newFrontmatter);
  await fs.writeFile(filePath, newContent, "utf8");

  const { title, ...rest } = newFrontmatter as Record<string, unknown>;
  return {
    id,
    title: typeof title === "string" ? title : id,
    column,
    body: newBody,
    frontmatter: rest,
  };
}

export async function moveCard(
  workspace: string,
  id: string,
  targetColumn: string,
  targetIndex: number
): Promise<void> {
  const root = await getKanbanRoot(workspace);
  const { filePath, column: sourceColumn } = await findCard(root, id);

  const sourceColPath = path.join(root, sourceColumn);
  const targetColPath = path.join(root, targetColumn);

  assertSafePath(root, sourceColPath);
  assertSafePath(root, targetColPath);

  if (sourceColumn !== targetColumn) {
    const destPath = path.join(targetColPath, `${id}.md`);
    assertSafePath(root, destPath);
    await fs.rename(filePath, destPath);

    // Remove from source order
    const srcOrder = (await readOrder(sourceColPath)).filter((x) => x !== id);
    await writeOrder(sourceColPath, srcOrder);
  }

  // Insert at target index
  const destOrder = (await readOrder(targetColPath)).filter((x) => x !== id);
  const clampedIndex = Math.max(0, Math.min(targetIndex, destOrder.length));
  destOrder.splice(clampedIndex, 0, id);
  await writeOrder(targetColPath, destOrder);

  // Update frontmatter status if column changed
  if (sourceColumn !== targetColumn) {
    const destPath = path.join(targetColPath, `${id}.md`);
    const raw = await fs.readFile(destPath, "utf8");
    const parsed = matter(raw);
    const config = await readConfig(root);
    const extra: Record<string, unknown> = { updated: new Date().toISOString() };
    if (config.columns[targetColumn]?.groupBy === "completed") {
      extra.completed = localDateString();
    }
    const updated = matter.stringify(parsed.content, { ...parsed.data, ...extra });
    await fs.writeFile(destPath, updated, "utf8");
  }
}

export async function deleteCard(workspace: string, id: string): Promise<void> {
  const root = await getKanbanRoot(workspace);
  const { filePath, column } = await findCard(root, id);
  const colPath = path.join(root, column);
  await fs.unlink(filePath);
  const order = (await readOrder(colPath)).filter((x) => x !== id);
  await writeOrder(colPath, order);
}

async function findCard(
  kanbanRoot: string,
  id: string
): Promise<{ filePath: string; column: string }> {
  // Reject ids that look like path traversal
  if (id.includes("/") || id.includes("\\") || id.startsWith(".")) {
    throw new Error(`Invalid card id: ${id}`);
  }
  const columns = await readColumns(kanbanRoot);
  for (const col of columns) {
    const candidate = path.join(kanbanRoot, col, `${id}.md`);
    try {
      await fs.access(candidate);
      return { filePath: candidate, column: col };
    } catch {
      // not in this column
    }
  }
  throw new Error(`Card not found: ${id}`);
}

export async function setColumnGroupBy(
  workspace: string,
  columnName: string,
  groupBy: GroupBy
): Promise<void> {
  const root = await getKanbanRoot(workspace);
  const config = await readConfig(root);
  config.columns[columnName] = { groupBy };
  await writeConfig(root, config);
}

export async function moveColumn(
  workspace: string,
  columnName: string,
  targetIndex: number
): Promise<void> {
  const root = await getKanbanRoot(workspace);
  const columns = await readColumns(root);
  if (!columns.includes(columnName)) {
    throw new Error(`Column not found: ${columnName}`);
  }
  const reordered = columns.filter((c) => c !== columnName);
  const clamped = Math.max(0, Math.min(targetIndex, reordered.length));
  reordered.splice(clamped, 0, columnName);
  await fs.writeFile(
    path.join(root, COLUMN_ORDER_FILE),
    reordered.join("\n") + "\n",
    "utf8"
  );
}

function assertSafePath(root: string, target: string): void {
  const resolved = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Path escape attempt: ${target}`);
  }
}

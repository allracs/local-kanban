import { Router } from "express";
import { z } from "zod";
import { nanoid } from "./util/nanoid.js";
import {
  readBoard,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  moveColumn,
  setColumnGroupBy,
} from "./fs/board.js";

export function createRouter(workspace: string): Router {
  const router = Router();

  router.get("/board", async (_req, res) => {
    try {
      const board = await readBoard(workspace);
      res.json(board);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/cards", async (req, res) => {
    const body = z
      .object({
        column: z.string().min(1),
        title: z.string().min(1),
        body: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }
    const { column, title, body: cardBody } = body.data;
    const id = slugify(title) + "-" + nanoid(6);
    try {
      const card = await createCard(workspace, column, id, title, cardBody);
      res.status(201).json(card);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch("/cards/:id", async (req, res) => {
    const patch = z
      .object({
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        frontmatter: z.record(z.unknown()).optional(),
      })
      .safeParse(req.body);
    if (!patch.success) {
      res.status(400).json({ error: patch.error.flatten() });
      return;
    }
    try {
      const card = await updateCard(workspace, req.params.id, patch.data);
      res.json(card);
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.post("/cards/:id/move", async (req, res) => {
    const body = z
      .object({ column: z.string().min(1), index: z.number().int().min(0) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }
    try {
      await moveCard(workspace, req.params.id, body.data.column, body.data.index);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.post("/columns/:name/move", async (req, res) => {
    const body = z
      .object({ index: z.number().int().min(0) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }
    try {
      await moveColumn(workspace, req.params.name, body.data.index);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.patch("/columns/:name", async (req, res) => {
    const body = z
      .object({ groupBy: z.enum(["none", "scheduled", "completed"]) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }
    try {
      await setColumnGroupBy(workspace, req.params.name, body.data.groupBy);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.delete("/cards/:id", async (req, res) => {
    try {
      await deleteCard(workspace, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  return router;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

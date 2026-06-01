import type { BoardState, Card, GroupBy } from "@kanban/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getBoard: () => request<BoardState>("/board"),

  createCard: (column: string, title: string, body?: string) =>
    request<Card>("/cards", {
      method: "POST",
      body: JSON.stringify({ column, title, body }),
    }),

  updateCard: (id: string, patch: { title?: string; body?: string; frontmatter?: Record<string, unknown> }) =>
    request<Card>(`/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  moveCard: (id: string, column: string, index: number) =>
    request<{ ok: boolean }>(`/cards/${encodeURIComponent(id)}/move`, {
      method: "POST",
      body: JSON.stringify({ column, index }),
    }),

  deleteCard: (id: string) =>
    request<{ ok: boolean }>(`/cards/${encodeURIComponent(id)}`, { method: "DELETE" }),

  moveColumn: (name: string, index: number) =>
    request<{ ok: boolean }>(`/columns/${encodeURIComponent(name)}/move`, {
      method: "POST",
      body: JSON.stringify({ index }),
    }),

  setColumnGroupBy: (name: string, groupBy: GroupBy) =>
    request<{ ok: boolean }>(`/columns/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ groupBy }),
    }),
};

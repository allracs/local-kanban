import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardState, Card } from "@kanban/shared";
import { localDateString } from "@kanban/shared";
import { Column } from "./Column.js";
import { CardItem } from "./CardItem.js";
import { CardModal } from "./CardModal.js";
import { api } from "../api.js";
import styles from "./Board.module.css";

interface Props {
  board: BoardState;
  onBoardChange: (board: BoardState) => void;
}

// dnd-kit's default rectIntersection only registers a drop when the dragged
// card's box physically overlaps a target's box. Because columns are sized to
// their content (align-items: flex-start), an empty column is short, so a card
// dragged across from a tall column never overlaps it and can't be dropped.
//
// Instead, prefer whatever droppable the pointer is actually over (precise, and
// preserves the tuned per-day-section targeting), and only fall back to the
// nearest droppable by distance when the pointer is in a gap (e.g. beside a
// short empty column). We scope by drag type so a column drag only collides
// with other columns, never with the cards nested inside them.
const collisionDetection: CollisionDetection = (args) => {
  const draggingColumn = args.active.data.current?.type === "column";
  const containers = args.droppableContainers.filter((c) =>
    draggingColumn
      ? c.data.current?.type === "column"
      : c.data.current?.type !== "column"
  );
  const scoped = { ...args, droppableContainers: containers };
  if (!draggingColumn) {
    const pointerHits = pointerWithin(scoped);
    if (pointerHits.length > 0) return pointerHits;
  }
  return closestCorners(scoped);
};

export function Board({ board, onBoardChange }: Props) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  // The card's day/column when the drag started, so on drop we know whether the
  // scheduled date actually changed and needs persisting.
  const dragOrigin = useRef<{ column: string; scheduled: string | null } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "column") return;
    const card = board.cards[event.active.id as string];
    if (card) {
      setActiveCard(card);
      dragOrigin.current = { column: card.column, scheduled: cardScheduled(card) };
    }
  };

  // While dragging over a scheduled-grouped section/card, re-stamp the card's day
  // in local state so it (and its drag placeholder) move into the hovered section
  // instead of leaving a "shadow" behind in the source section.
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.data.current?.type === "column") return;
    const cardId = active.id as string;
    const card = board.cards[cardId];
    if (!card) return;

    const target = resolveScheduledTarget(over.id as string, board);
    if (!target) return; // destination isn't a scheduled-grouped column

    if (card.column === target.column && cardScheduled(card) === target.scheduled) return;
    onBoardChange(applyScheduleDuringDrag(board, cardId, target.column, target.scheduled));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCard(null);
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    const { active, over } = event;
    if (!over) return;

    // Column reorder
    if (active.data.current?.type === "column") {
      const activeColName = (active.id as string).replace(/^col:/, "");
      const overColName = (over.id as string).replace(/^col:/, "");
      if (activeColName === overColName) return;
      const fromIndex = board.columns.findIndex((c) => c.name === activeColName);
      const toIndex = board.columns.findIndex((c) => c.name === overColName);
      if (fromIndex === -1 || toIndex === -1) return;

      // Optimistic update
      const newColumns = [...board.columns];
      const [moved] = newColumns.splice(fromIndex, 1);
      newColumns.splice(toIndex, 0, moved);
      onBoardChange({ ...board, columns: newColumns });

      try {
        await api.moveColumn(activeColName, toIndex);
      } catch (err) {
        console.error("Column move failed", err);
      }
      return;
    }

    const cardId = active.id as string;
    // `board` already reflects any optimistic reschedule from handleDragOver.
    const card = board.cards[cardId];
    if (!card) return;

    // Resolve the final column + index. over.id may be a day section, a card, or a column.
    const overId = over.id as string;
    let targetColumn: string;
    let targetIndex: number;
    if (overId.startsWith("day|")) {
      const sep = overId.indexOf("|", 4);
      targetColumn = overId.slice(4, sep);
      const col = board.columns.find((c) => c.name === targetColumn);
      const at = col ? col.cardIds.indexOf(cardId) : -1;
      targetIndex = at >= 0 ? at : col ? col.cardIds.length : 0;
    } else if (board.cards[overId]) {
      const overCard = board.cards[overId];
      targetColumn = overCard.column;
      const col = board.columns.find((c) => c.name === targetColumn);
      targetIndex = col ? Math.max(0, col.cardIds.indexOf(overId)) : 0;
    } else {
      targetColumn = overId;
      const col = board.columns.find((c) => c.name === targetColumn);
      targetIndex = col ? col.cardIds.length : 0;
    }

    let finalBoard = applyMove(board, cardId, targetColumn, targetIndex);
    // Moving into a completed-grouped column (e.g. Done) marks the card completed
    // today on the server; stamp it optimistically so it buckets under "Today"
    // immediately instead of flashing under "No date" until the next sync.
    const targetCol = finalBoard.columns.find((c) => c.name === targetColumn);
    if (targetCol?.groupBy === "completed" && card.column !== targetColumn) {
      const moved = finalBoard.cards[cardId];
      finalBoard = {
        ...finalBoard,
        cards: {
          ...finalBoard.cards,
          [cardId]: { ...moved, frontmatter: { ...moved.frontmatter, completed: localDateString() } },
        },
      };
    }
    onBoardChange(finalBoard);

    const finalIndex = finalBoard.columns
      .find((c) => c.name === targetColumn)!
      .cardIds.indexOf(cardId);
    const finalScheduled = cardScheduled(finalBoard.cards[cardId]);

    try {
      await api.moveCard(cardId, targetColumn, finalIndex);
      if (origin && finalScheduled !== origin.scheduled) {
        await api.updateCard(cardId, { frontmatter: { scheduled: finalScheduled } });
      }
    } catch (err) {
      console.error("Move failed", err);
    }
  };

  const handleSetGroupBy = async (column: string, groupBy: import("@kanban/shared").GroupBy) => {
    try {
      await api.setColumnGroupBy(column, groupBy);
    } catch (err) {
      console.error("Set grouping failed", err);
    }
  };

  const handleAddCard = async (column: string, title: string) => {
    try {
      await api.createCard(column, title);
    } catch (err) {
      console.error("Create failed", err);
    }
  };

  const handleSave = async (patch: { title: string; body: string; frontmatter: Record<string, unknown> }) => {
    if (!editingCard) return;
    try {
      await api.updateCard(editingCard.id, patch);
      setEditingCard(null);
    } catch (err) {
      console.error("Update failed", err);
    }
  };

  const handleDelete = async () => {
    if (!editingCard) return;
    try {
      await api.deleteCard(editingCard.id);
      setEditingCard(null);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <SortableContext items={board.columns.map((c) => "col:" + c.name)} strategy={horizontalListSortingStrategy}>
          <div className={styles.board}>
            {board.columns.map((col) => (
              <Column
                key={col.name}
                column={col}
                cards={col.cardIds.map((id) => board.cards[id]).filter(Boolean)}
                onAddCard={handleAddCard}
                onCardClick={setEditingCard}
                onSetGroupBy={handleSetGroupBy}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeCard ? (
            <CardItem card={activeCard} onClick={() => {}} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {editingCard && (
        <CardModal
          card={editingCard}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingCard(null)}
        />
      )}
    </>
  );
}

function cardScheduled(card: Card): string | null {
  const s = card.frontmatter?.scheduled;
  return typeof s === "string" && s ? s : null;
}

// The scheduled date a given day-section key represents.
function scheduledForGroupKey(groupKey: string): string | null {
  if (groupKey === "today") return localDateString();
  if (groupKey === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDateString(d);
  }
  if (groupKey === "unscheduled" || groupKey === "overdue") return null;
  return groupKey; // a concrete YYYY-MM-DD future date
}

// Given what the pointer is over, figure out the destination column and the day
// the card should adopt — but only for scheduled-grouped columns (otherwise null).
function resolveScheduledTarget(
  overId: string,
  board: BoardState
): { column: string; scheduled: string | null } | null {
  if (overId.startsWith("day|")) {
    const sep = overId.indexOf("|", 4);
    const column = overId.slice(4, sep);
    const col = board.columns.find((c) => c.name === column);
    if (col?.groupBy !== "scheduled") return null;
    return { column, scheduled: scheduledForGroupKey(overId.slice(sep + 1)) };
  }
  const overCard = board.cards[overId];
  if (overCard) {
    const col = board.columns.find((c) => c.name === overCard.column);
    if (col?.groupBy !== "scheduled") return null;
    return { column: overCard.column, scheduled: cardScheduled(overCard) };
  }
  return null;
}

// Optimistically move a card into a scheduled column/day during a drag: relocate
// it to the target column if needed, then set its scheduled date so it re-buckets.
function applyScheduleDuringDrag(
  board: BoardState,
  cardId: string,
  targetColumn: string,
  scheduled: string | null
): BoardState {
  let next = board;
  if (board.cards[cardId].column !== targetColumn) {
    const col = board.columns.find((c) => c.name === targetColumn);
    next = applyMove(board, cardId, targetColumn, col ? col.cardIds.length : 0);
  }
  const card = next.cards[cardId];
  const frontmatter = { ...card.frontmatter };
  if (scheduled) frontmatter.scheduled = scheduled;
  else delete frontmatter.scheduled;
  return { ...next, cards: { ...next.cards, [cardId]: { ...card, frontmatter } } };
}

function applyMove(board: BoardState, cardId: string, targetColumn: string, targetIndex: number): BoardState {
  const card = board.cards[cardId];
  const srcColName = card.column;

  const newColumns = board.columns.map((col) => {
    if (col.name === srcColName && col.name !== targetColumn) {
      return { ...col, cardIds: col.cardIds.filter((id) => id !== cardId) };
    }
    if (col.name === targetColumn) {
      const filtered = col.cardIds.filter((id) => id !== cardId);
      filtered.splice(Math.max(0, Math.min(targetIndex, filtered.length)), 0, cardId);
      return { ...col, cardIds: filtered };
    }
    return col;
  });

  // same column move
  if (srcColName === targetColumn) {
    const idx = newColumns.findIndex((c) => c.name === srcColName);
    const filtered = newColumns[idx].cardIds.filter((id) => id !== cardId);
    filtered.splice(Math.max(0, Math.min(targetIndex, filtered.length)), 0, cardId);
    newColumns[idx] = { ...newColumns[idx], cardIds: filtered };
  }

  return {
    projectName: board.projectName,
    columns: newColumns,
    cards: { ...board.cards, [cardId]: { ...card, column: targetColumn } },
  };
}

import { useRef, useState } from "react";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeDayGroups, localDateString } from "@kanban/shared";
import type { Card, Column as ColumnType, GroupBy, DayGroup } from "@kanban/shared";
import { CardItem } from "./CardItem.js";
import styles from "./Column.module.css";

interface Props {
  column: ColumnType;
  cards: Card[];
  onAddCard: (column: string, title: string) => void;
  onCardClick: (card: Card) => void;
  onSetGroupBy: (column: string, groupBy: GroupBy) => void;
}

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  scheduled: "By scheduled date",
  completed: "By completed date",
};

function DayGroupSection({ column, group, cards, onCardClick }: {
  column: string;
  group: DayGroup;
  cards: Card[];
  onCardClick: (card: Card) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day|${column}|${group.key}`,
    disabled: !group.droppable,
    data: { type: "day", column, groupKey: group.key },
  });
  const { active, over } = useDndContext();
  const dragHeight =
    active?.rect.current.translated?.height ??
    active?.rect.current.initial?.height ?? 0;
  const groupCards = group.cardIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as Card[];
  // The section counts as hovered when the drag is over the section itself OR over
  // any card inside it (cards are their own droppables, so isOver alone misses them).
  const overId = over?.id as string | undefined;
  const sectionHovered =
    isOver || (overId != null && group.cardIds.includes(overId));
  // Show the drop box for empty droppable groups always, and for populated ones
  // only while a card is being dragged (not during a column drag).
  const draggingCard = active != null && active.data.current?.type !== "column";
  const activeId = active?.id as string | undefined;
  // While dragging, hold empty sections (or one containing only the dragged card's
  // projection) at the dragged card's height. The slot becomes a card-sized drop
  // target, and the projection grows/shrinks inside it without the section jumping.
  const onlyDraggedHere =
    groupCards.length === 1 && activeId != null && group.cardIds[0] === activeId;
  const dropStyle =
    group.droppable && draggingCard && dragHeight && (groupCards.length === 0 || onlyDraggedHere)
      ? { minHeight: dragHeight }
      : undefined;
  const showDrop = group.droppable && (groupCards.length === 0 || draggingCard);
  // Each section is its own sortable list, so reordering inside one section never
  // displaces cards in another section.
  const cardList = (
    <SortableContext items={group.cardIds} strategy={verticalListSortingStrategy}>
      {groupCards.map((card) => (
        <CardItem key={card.id} card={card} onClick={() => onCardClick(card)} />
      ))}
    </SortableContext>
  );
  return (
    <div className={styles.dayGroup}>
      <div className={styles.dayHeader}>
        <span className={styles.dayLabel}>{group.label}</span>
        <span className={styles.dayCount}>{groupCards.length}</span>
      </div>
      {group.droppable ? (
        <div
          ref={setNodeRef}
          style={dropStyle}
          className={`${styles.dayDrop} ${showDrop ? styles.dayDropActive : ""} ${sectionHovered ? styles.dayDropOver : ""}`}
        >
          {group.cardIds.length === 0 && <span className={styles.dayHint}>Drop here</span>}
          {cardList}
        </div>
      ) : (
        <div ref={setNodeRef} className={styles.dayCards}>
          {cardList}
        </div>
      )}
    </div>
  );
}

export function Column({ column, cards, onAddCard, onCardClick, onSetGroupBy }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: "col:" + column.name, data: { type: "column" } });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: column.name });

  const columnStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const startAdding = () => {
    setAdding(true);
    setTitle("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const cancel = () => { setAdding(false); setTitle(""); };
  const submit = () => {
    const trimmed = title.trim();
    if (trimmed) onAddCard(column.name, trimmed);
    cancel();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === "Escape") cancel();
  };

  const grouped = column.groupBy !== "none";
  const groups = grouped ? computeDayGroups(cards, column.groupBy, localDateString()) : [];

  return (
    <div ref={setSortableRef} style={columnStyle} className={`${styles.column} ${isOver ? styles.over : ""}`}>
      <div className={styles.header}>
        <button className={styles.dragHandle} {...attributes} {...listeners} aria-label="Drag column">⠿</button>
        <span className={styles.name}>{column.name}</span>
        <span className={styles.count}>{cards.length}</span>
        <div className={styles.menuWrap}>
          <button className={styles.menuBtn} onClick={() => setMenuOpen((o) => !o)} aria-label="Column options">⋯</button>
          {menuOpen && (
            <div className={styles.menu} onMouseLeave={() => setMenuOpen(false)}>
              {(["none", "scheduled", "completed"] as GroupBy[]).map((gb) => (
                <button
                  key={gb}
                  className={`${styles.menuItem} ${column.groupBy === gb ? styles.menuItemActive : ""}`}
                  onClick={() => { onSetGroupBy(column.name, gb); setMenuOpen(false); }}
                >
                  {GROUP_BY_LABELS[gb]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={setDropRef} className={styles.cards}>
        {grouped ? (
          groups.map((g) => (
            <DayGroupSection key={g.key} column={column.name} group={g} cards={cards} onCardClick={onCardClick} />
          ))
        ) : (
          <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {cards.map((card) => (
              <CardItem key={card.id} card={card} onClick={() => onCardClick(card)} />
            ))}
          </SortableContext>
        )}
        {!grouped && cards.length === 0 && !adding && (
          <div className={styles.empty}>Drop cards here</div>
        )}
      </div>

      {adding ? (
        <div className={styles.addForm}>
          <textarea
            ref={inputRef}
            name="cardTitle"
            className={styles.addInput}
            placeholder="Enter a title…"
            value={title}
            rows={2}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={submit}
          />
        </div>
      ) : (
        <button className={styles.addBtn} onClick={startAdding}>+ Add card</button>
      )}
    </div>
  );
}

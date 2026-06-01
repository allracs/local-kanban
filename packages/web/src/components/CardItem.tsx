import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "@kanban/shared";
import styles from "./CardItem.module.css";

const PRIORITY_COLORS: Record<string, string> = {
  low:    "#60a5fa",
  medium: "#fbbf24",
  high:   "#f97316",
  urgent: "#ef4444",
};

function PriorityIcon({ priority }: { priority: string | undefined }) {
  const color = priority && PRIORITY_COLORS[priority] ? PRIORITY_COLORS[priority] : "#d1d5db";
  return (
    <svg
      className={styles.priorityIcon}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={priority ? `Priority: ${priority}` : "No priority"}
    >
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  );
}

interface Props {
  card: Card;
  onClick: () => void;
  // The floating DragOverlay clone — render it static (no enter animation).
  overlay?: boolean;
}

export function CardItem({ card, onClick, overlay }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const priority = card.frontmatter?.priority as string | undefined;

  // The sortable transform/transition live on the grid wrapper; the wrapper also
  // animates its row open (grid-template-rows 0fr→1fr) each time it mounts, so the
  // projection grows in height when the dragged card enters a new section.
  const wrapStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={wrapStyle}
      className={`${styles.cardWrap} ${overlay ? "" : styles.cardWrapEnter}`}
      {...attributes}
      {...listeners}
    >
      <div
        className={styles.card}
        style={{ opacity: isDragging ? 0.4 : 1 }}
        onClick={onClick}
      >
        <div className={styles.cardRow}>
          <PriorityIcon priority={priority} />
          <span className={styles.title}>{card.title}</span>
        </div>
        {Array.isArray(card.frontmatter.tags) && card.frontmatter.tags.length > 0 && (
          <div className={styles.tags}>
            {(card.frontmatter.tags as string[]).map((t) => (
              <span key={t} className={styles.tag}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

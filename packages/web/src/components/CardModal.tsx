import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Card } from "@kanban/shared";
import styles from "./CardModal.module.css";

type Priority = "none" | "low" | "medium" | "high" | "urgent";

const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: "none",   label: "None",   color: "#9ca3af" },
  { value: "low",    label: "Low",    color: "#60a5fa" },
  { value: "medium", label: "Medium", color: "#fbbf24" },
  { value: "high",   label: "High",   color: "#f97316" },
  { value: "urgent", label: "Urgent", color: "#ef4444" },
];

interface Props {
  card: Card;
  onSave: (patch: { title: string; body: string; frontmatter: Record<string, unknown> }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CardModal({ card, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [tagsInput, setTagsInput] = useState(
    Array.isArray(card.frontmatter?.tags) ? (card.frontmatter.tags as string[]).join(", ") : ""
  );
  const [priority, setPriority] = useState<Priority>(
    (card.frontmatter?.priority as Priority) ?? "none"
  );
  const [scheduled, setScheduled] = useState<string>(
    typeof card.frontmatter?.scheduled === "string" ? card.frontmatter.scheduled : ""
  );
  const [editingBody, setEditingBody] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  useEffect(() => {
    setTitle(card.title);
    setBody(card.body);
    setTagsInput(Array.isArray(card.frontmatter?.tags) ? (card.frontmatter.tags as string[]).join(", ") : "");
    setPriority((card.frontmatter?.priority as Priority) ?? "none");
    setScheduled(typeof card.frontmatter?.scheduled === "string" ? card.frontmatter.scheduled : "");
    setEditingBody(false);
    setEditingTags(false);
  }, [card.id]);

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  const saveAndClose = () => {
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    onSave({ title, body, frontmatter: { tags, priority, scheduled: scheduled || null } });
    onClose();
  };

  const handleModalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      if (title.trim()) saveAndClose();
      return;
    }
    if (e.key !== "Escape") return;
    if (e.target !== e.currentTarget) {
      // Focus is inside a child input — move it to the modal so a second Escape closes
      e.preventDefault();
      modalRef.current?.focus();
    } else {
      // Focus is on the modal itself — save and close
      saveAndClose();
    }
  };

  const parsedTags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" ref={modalRef} tabIndex={-1} onKeyDown={handleModalKeyDown}>
        <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        <input
          className={styles.titleInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Card title"
        />
        <div className={styles.meta}>
          <span className={styles.column}>{card.column}</span>
          <span className={styles.id}>{card.id}</span>
        </div>
        <div className={styles.tagsLabel}>
          Tags (comma separated)
          {editingTags ? (
            <input
              className={styles.tagsInput}
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tags, comma, separated"
              autoFocus
              onBlur={() => setEditingTags(false)}
            />
          ) : (
            <div
              className={styles.tagsPreview}
              onClick={() => setEditingTags(true)}
              onFocus={() => setEditingTags(true)}
              tabIndex={0}
            >
              {parsedTags.length > 0 ? (
                parsedTags.map((t) => <span key={t} className={styles.tag}>{t}</span>)
              ) : (
                <span className={styles.tagsPreviewEmpty}>Add tags…</span>
              )}
            </div>
          )}
        </div>
        <div className={styles.priorityLabel}>
          Priority
          <div className={styles.priorityPicker}>
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`${styles.priorityBtn}${priority === p.value ? ` ${styles.priorityBtnActive}` : ""}`}
                style={{ "--priority-color": p.color } as React.CSSProperties}
                onClick={() => setPriority(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.scheduledLabel}>
          Scheduled
          <div className={styles.scheduledRow}>
            <input
              type="date"
              className={styles.scheduledInput}
              value={scheduled}
              onChange={(e) => setScheduled(e.target.value)}
            />
            {scheduled && (
              <button type="button" className={styles.scheduledClear} onClick={() => setScheduled("")}>
                Clear
              </button>
            )}
          </div>
          {typeof card.frontmatter?.completed === "string" && (
            <div className={styles.completedNote}>Completed {card.frontmatter.completed as string}</div>
          )}
        </div>
        {editingBody ? (
          <textarea
            name="cardBody"
            className={styles.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a description (markdown supported)…"
            autoFocus
            onBlur={() => setEditingBody(false)}
          />
        ) : (
          <div
            className={`${styles.bodyPreview}${body.trim() ? "" : ` ${styles.bodyPreviewEmpty}`}`}
            onClick={() => setEditingBody(true)}
          >
            {body.trim() ? (
              <ReactMarkdown>{body}</ReactMarkdown>
            ) : (
              "Add a description (markdown supported)…"
            )}
          </div>
        )}
        <div className={styles.actions}>
          <button
            className={styles.deleteBtn}
            onClick={() => { if (confirm("Delete this card?")) onDelete(); }}
          >
            Delete
          </button>
          <button
            className={styles.saveBtn}
            onClick={saveAndClose}
            disabled={!title.trim()}
          >
            Save <span className={styles.saveHint}>({isMac ? "⌘+Enter" : "Ctrl+Enter"})</span>
          </button>
        </div>
      </div>
    </div>
  );
}

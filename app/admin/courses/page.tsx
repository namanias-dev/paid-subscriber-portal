"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, verticalListSortingStrategy,
  sortableKeyboardCoordinates, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { GripVertical, Check, Loader2, AlertCircle } from "lucide-react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/dates";
import type { Course } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function CoursesAdmin() {
  const { data: courses, loading, reload } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();
  const [items, setItems] = useState<Course[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    if (courses) setItems(courses);
  }, [courses]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persist(ordered: Course[], previous: Course[]) {
    setSaveState("saving");
    try {
      const res = await fetch("/api/admin/courses/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ordered.map((c) => c.id) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setItems(previous);
      setSaveState("error");
      toast("Could not save order — reverted.", "error");
      setTimeout(() => setSaveState("idle"), 2500);
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((c) => c.id === active.id);
    const newIndex = items.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = items;
    const ordered = arrayMove(items, oldIndex, newIndex);
    setItems(ordered);
    persist(ordered, previous);
  }

  function moveToPosition(id: string, pos: number) {
    const oldIndex = items.findIndex((c) => c.id === id);
    if (oldIndex < 0) return;
    const target = Math.max(0, Math.min(items.length - 1, pos - 1));
    if (target === oldIndex) return;
    const previous = items;
    const ordered = arrayMove(items, oldIndex, target);
    setItems(ordered);
    persist(ordered, previous);
  }

  async function remove(id: string) {
    if (!confirm("Delete this course?")) return;
    const previous = items;
    setItems((cur) => cur.filter((c) => c.id !== id));
    const res = await fetch(`/api/admin/courses/${id}`, { method: "DELETE" });
    if (!res.ok) { setItems(previous); toast("Delete failed", "error"); return; }
    toast("Deleted", "success");
    reload();
  }

  async function toggleActive(c: Course) {
    const next = c.active === false;
    setItems((cur) => cur.map((x) => (x.id === c.id ? { ...x, active: next } : x)));
    await fetch(`/api/admin/courses/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    toast(next ? "Course enabled" : "Course disabled — hidden from public", "success");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Course Manager"
        subtitle="Drag to reorder — this controls the order on the public Courses page"
        action={<Link href="/admin/courses/new" className="btn btn-primary text-sm">+ New Course</Link>}
      />

      <div className="mb-3 flex items-center gap-2 text-xs text-ink2">
        <span className="inline-flex items-center gap-1.5">
          <GripVertical size={14} /> Drag rows to set the public display order.
        </span>
        <span aria-live="polite" className="ml-auto inline-flex items-center gap-1.5">
          {saveState === "saving" && <><Loader2 size={14} className="animate-spin" /> Saving…</>}
          {saveState === "saved" && <span className="inline-flex items-center gap-1.5 text-success"><Check size={14} /> Saved</span>}
          {saveState === "error" && <span className="inline-flex items-center gap-1.5 text-danger"><AlertCircle size={14} /> Not saved</span>}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink2">No courses yet. Create your first one.</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext items={items.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((c, i) => (
                <SortableRow
                  key={c.id}
                  course={c}
                  index={i}
                  total={items.length}
                  onRemove={remove}
                  onToggle={toggleActive}
                  onMove={moveToPosition}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRow({
  course: c, index, total, onRemove, onToggle, onMove,
}: {
  course: Course;
  index: number;
  total: number;
  onRemove: (id: string) => void;
  onToggle: (c: Course) => void;
  onMove: (id: string, pos: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id });
  const [pos, setPos] = useState(String(index + 1));

  useEffect(() => { setPos(String(index + 1)); }, [index]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`card flex items-center gap-3 p-3 ${isDragging ? "shadow-lg ring-1 ring-primary/40" : ""}`}
    >
      <button
        type="button"
        className="ca-focus flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-ink active:cursor-grabbing"
        aria-label={`Reorder ${c.title}. Use arrow keys to move.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>

      <input
        type="number"
        min={1}
        max={total}
        value={pos}
        onChange={(e) => setPos(e.target.value)}
        onBlur={() => { const n = parseInt(pos, 10); if (!Number.isNaN(n)) onMove(c.id, n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        aria-label={`Position for ${c.title}`}
        className="h-9 w-12 shrink-0 rounded-lg border border-line bg-surface text-center text-sm"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.title}</p>
        <p className="truncate text-xs text-ink2">{c.category} · {c.modes.join(", ")} · {c.price === 0 ? "Free" : formatINR(c.price)}</p>
      </div>

      <div className="hidden shrink-0 sm:block">
        {c.active === false ? (
          <span className="pill pill-gray">Disabled</span>
        ) : (
          <span className={`pill ${c.status === "published" ? "pill-green" : c.status === "draft" ? "pill-amber" : "pill-gray"}`}>{c.status}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 text-xs">
        <a href={`/courses/${c.slug}`} target="_blank" rel="noopener noreferrer" className="hidden text-primary sm:inline">View ↗</a>
        <Link href={`/admin/courses/${c.id}/edit`} className="text-primary">Edit</Link>
        <button onClick={() => onToggle(c)} className="text-ink2">{c.active === false ? "Enable" : "Disable"}</button>
        <button onClick={() => onRemove(c.id)} className="text-danger">Delete</button>
      </div>
    </li>
  );
}

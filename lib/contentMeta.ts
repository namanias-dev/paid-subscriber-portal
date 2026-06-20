import type { ContentType } from "./types";

export const CONTENT_META: Record<
  ContentType,
  { icon: string; label: string; action: string }
> = {
  current_affairs: { icon: "📰", label: "Current Affairs", action: "View / Download" },
  mcq: { icon: "📝", label: "Prelims MCQs", action: "Attempt Now" },
  booklet: { icon: "📚", label: "Booklet", action: "Open Booklet" },
  recording: { icon: "🎥", label: "Recording", action: "Watch Recording" },
  live_link: { icon: "🔴", label: "Live Class", action: "Join Now" },
  pyq: { icon: "🗂️", label: "PYQ Bank", action: "Open PYQs" },
  test_series: { icon: "🧪", label: "Test Series", action: "Start Test" },
  answer_writing: { icon: "✍️", label: "Answer Writing", action: "Open Question" },
  notes: { icon: "🗒️", label: "Notes", action: "Open Notes" },
  maps: { icon: "🗺️", label: "Maps", action: "Open Maps" },
};

export const CONTENT_TABS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "current_affairs", label: "CA" },
  { id: "mcq", label: "MCQs" },
  { id: "booklet", label: "Booklets" },
  { id: "pyq", label: "PYQs" },
  { id: "recording", label: "Recordings" },
  { id: "answer_writing", label: "Answer Writing" },
  { id: "test_series", label: "Test Series" },
  { id: "notes", label: "Notes" },
  { id: "maps", label: "Maps" },
];

export function contentLink(item: { drive_link: string | null; youtube_link: string | null }): string | null {
  return item.youtube_link || item.drive_link || null;
}

import type { ContentType } from "./types";

export const CONTENT_META: Record<
  ContentType,
  { icon: string; label: string; action: string }
> = {
  current_affairs: { icon: "current_affairs", label: "Current Affairs", action: "View / Download" },
  mcq: { icon: "mcq", label: "Prelims MCQs", action: "Attempt Now" },
  booklet: { icon: "booklet", label: "Booklet", action: "Open Booklet" },
  recording: { icon: "recording", label: "Recording", action: "Watch Recording" },
  live_link: { icon: "live_link", label: "Live Class", action: "Join Now" },
  pyq: { icon: "pyq", label: "PYQ Bank", action: "Open PYQs" },
  test_series: { icon: "test_series", label: "Test Series", action: "Start Test" },
  answer_writing: { icon: "answer_writing", label: "Answer Writing", action: "Open Question" },
  notes: { icon: "notes", label: "Notes", action: "Open Notes" },
  maps: { icon: "maps", label: "Maps", action: "Open Maps" },
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

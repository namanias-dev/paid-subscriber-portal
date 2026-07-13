import type { LucideIcon } from "lucide-react";
import {
  Users,
  GraduationCap,
  Handshake,
  MapPin,
  Building2,
  MonitorPlay,
  Video,
  Shuffle,
  Newspaper,
  PenLine,
  FileDown,
  Send,
  Compass,
  BookOpen,
  Target,
  Mic,
  Landmark,
} from "lucide-react";

/**
 * Static, editorial copy for the Home V2 sections. This mirrors the textual
 * content of the current homepage so V2 is a faithful, premium re-flow rather
 * than a rewrite. Anything data-driven (courses, toppers, webinars, hero copy,
 * headings) still comes from admin settings / the data provider at render time.
 */

export const WHY_V2: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Users, title: "Small batches (~40)", desc: "Personal attention for every aspirant — not a crowded hall." },
  { icon: GraduationCap, title: "9+ years of mentoring", desc: "A proven, refined methodology that produces results." },
  { icon: Handshake, title: "Direct faculty mentorship", desc: "Learn from Naman Sir directly, with 1:1 guidance." },
  { icon: MapPin, title: "Chandigarh se bhi UPSC", desc: "World-class preparation, right here in the Tricity." },
];

export const MODES_V2: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Building2, title: "Offline — Chandigarh", desc: "Classroom batches at Sector 17C." },
  { icon: MonitorPlay, title: "Live Online — Pan India", desc: "Interactive live classes from anywhere." },
  { icon: Video, title: "Recorded", desc: "Self-paced learning, anytime access." },
  { icon: Shuffle, title: "Hybrid", desc: "Best of both — class + recordings." },
];

export const FREE_V2: { icon: LucideIcon; title: string }[] = [
  { icon: Newspaper, title: "Daily Current Affairs" },
  { icon: PenLine, title: "Daily MCQs" },
  { icon: FileDown, title: "Free PDFs & Notes" },
  { icon: Send, title: "Join Telegram (23K+)" },
];

export const FAQ_V2: { q: string; a: string }[] = [
  { q: "Do you teach in Hindi or English?", a: "Our classes are bilingual (Hinglish) so every aspirant can follow comfortably." },
  { q: "Are batches small?", a: "Yes — we deliberately keep batches around 40 students for genuine personal attention." },
  { q: "Can I attend from outside Chandigarh?", a: "Absolutely. Our Live Online and Recorded modes serve aspirants across India." },
  { q: "Is there an EMI option?", a: "Yes, most foundation programs offer easy monthly EMI. See each course page for details." },
  { q: "How do I start?", a: "Book a free demo or join the ₹50 beginner masterclass to experience our teaching first." },
];

/**
 * The aspirant's journey — the cinematic spine of the page. Confused beginner →
 * Foundation → Prelims → Mains → Interview → Officer. Abstract + aspirational.
 * Each stage links to a real destination on the site.
 */
export const JOURNEY_V2: {
  icon: LucideIcon;
  stage: string;
  title: string;
  desc: string;
  href: string;
}[] = [
  { icon: Compass, stage: "Stage 00", title: "The confused beginner", desc: "No roadmap, endless noise. We give you clarity and a plan from day one.", href: "/resources" },
  { icon: BookOpen, stage: "Stage 01", title: "Foundation & NCERTs", desc: "Build unshakeable basics — structured, syllabus-first, nothing wasted.", href: "/courses" },
  { icon: Target, stage: "Stage 02", title: "Prelims mastery", desc: "Daily MCQs, PYQs and test series that sharpen accuracy under pressure.", href: "/quizzes" },
  { icon: PenLine, stage: "Stage 03", title: "Mains & answer writing", desc: "Personal feedback that turns knowledge into exam-winning answers.", href: "/courses" },
  { icon: Mic, stage: "Stage 04", title: "The interview", desc: "Mock boards and mentorship to walk in calm, clear and confident.", href: "/demo" },
  { icon: Landmark, stage: "Stage 05", title: "The officer", desc: "The chair you're destined to fill. This is where the journey leads.", href: "/results" },
];

/**
 * Strip a leading emoji / pictograph (and any following whitespace) from an
 * admin-editable string so V2 can pair the honest text with a real vector icon
 * instead of an emoji glyph. Text content is otherwise preserved verbatim.
 */
export function stripLeadingEmoji(s: string): string {
  return s
    .replace(
      /^[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\s]+/u,
      "",
    )
    .trim();
}

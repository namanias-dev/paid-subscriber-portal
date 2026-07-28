import type { LucideIcon } from "lucide-react";
import { Compass, BookOpen, Layers, PenLine, MessagesSquare, Landmark } from "lucide-react";

/**
 * Editorial copy for the cinematic preview.
 *
 * House style: direct, UPSC-specific, mentor-led. Explicitly avoids the banned
 * register — no "unlock your potential", "transform your dreams", "revolutionize"
 * or "guaranteed selection". Nothing here states a statistic; every number on the
 * page comes from live data through the provenance gate in lib/homeCinematic.
 */

export interface JourneyStage {
  /** Short label used for the stage rail and analytics. */
  key: string;
  stage: string;
  title: string;
  desc: string;
  href: string;
  icon: LucideIcon;
}

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    key: "direction",
    stage: "Stage 01",
    title: "Direction",
    desc: "Before syllabus, before booklists — decide what you are actually preparing for, and whether UPSC is the right fit for the next three years of your life.",
    href: "/demo",
    icon: Compass,
  },
  {
    key: "foundation",
    stage: "Stage 02",
    title: "Foundation",
    desc: "NCERTs, standard books and the core GS papers, taught in sequence so each subject builds on the last instead of arriving as isolated notes.",
    href: "/courses",
    icon: BookOpen,
  },
  {
    key: "prelims-mains",
    stage: "Stage 03",
    title: "Prelims + Mains",
    desc: "Two exams with different demands, prepared together. Objective precision for Prelims, structured argument for Mains — not one at the cost of the other.",
    href: "/courses",
    icon: Layers,
  },
  {
    key: "testing",
    stage: "Stage 04",
    title: "Testing & Answer Writing",
    desc: "Weekly tests with answers actually read and marked. Answer writing is a skill built by correction, which is why feedback here is personal rather than a model answer PDF.",
    href: "/courses",
    icon: PenLine,
  },
  {
    key: "interview",
    stage: "Stage 05",
    title: "Interview",
    desc: "DAF-based mock panels and one-to-one preparation on your own board, service preferences and home state — the part of the exam that rewards clarity over coaching.",
    href: "/contact",
    icon: MessagesSquare,
  },
  {
    key: "civil-services",
    stage: "Stage 06",
    title: "Civil Services",
    desc: "The chair at the end of it. Everything above is preparation for the judgement the job asks for, not just for the marksheet that gets you there.",
    href: "/results",
    icon: Landmark,
  },
];

/** "Where are you now?" — six honest starting points. */
export interface StartingPoint {
  key: string;
  label: string;
  blurb: string;
  /** Course category we look for a live offer in, in priority order. */
  categories: string[];
  /** True when the masterclass is the most honest first step for this person. */
  preferMasterclass?: boolean;
  /** True when this answer is specifically about the offline Chandigarh centre. */
  offline?: boolean;
}

export const STARTING_POINTS: StartingPoint[] = [
  {
    key: "zero",
    label: "Starting from zero",
    blurb: "No preparation yet, and not sure where the syllabus even begins.",
    categories: ["Entry", "Foundation"],
    preferMasterclass: true,
  },
  {
    key: "college",
    label: "Still in college",
    blurb: "Studying alongside a degree, with limited hours on weekdays.",
    categories: ["Foundation", "Entry"],
  },
  {
    key: "working",
    label: "Working full-time",
    blurb: "A job to keep, so the plan has to survive a real work week.",
    categories: ["Foundation", "Specialist"],
  },
  {
    key: "preparing",
    label: "Already preparing",
    blurb: "Syllabus covered once, now looking for tests and answer-writing rigour.",
    categories: ["Test Series", "Mains"],
  },
  {
    key: "reattempting",
    label: "Re-attempting",
    blurb: "Cleared stages before and want to fix what specifically went wrong.",
    categories: ["Mentorship", "Test Series"],
  },
  {
    key: "chandigarh",
    label: "In Chandigarh",
    blurb: "Want a classroom and a mentor you can actually sit in front of.",
    categories: ["Foundation"],
    offline: true,
  },
];

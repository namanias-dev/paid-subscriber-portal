import type { LucideIcon } from "lucide-react";
import {
  // nav / structural
  LayoutDashboard,
  Home,
  GraduationCap,
  Newspaper,
  Radio,
  FlaskConical,
  ClipboardCheck,
  BookOpen,
  Handshake,
  Star,
  CreditCard,
  User,
  BookMarked,
  // admin
  BarChart3,
  LineChart,
  Trophy,
  Medal,
  Compass,
  BookText,
  Target,
  ClipboardList,
  Rocket,
  Megaphone,
  Gift,
  Briefcase,
  Bot,
  Smartphone,
  FolderOpen,
  Video,
  Library,
  MessageSquare,
  Gem,
  FileText,
  HelpCircle,
  ListChecks,
  FileStack,
  Users,
  Shuffle,
  Wallet,
  Armchair,
  Clock,
  AlertTriangle,
  ShieldAlert,
  UserCog,
  Settings,
  // content types
  BookCopy,
  PenLine,
  StickyNote,
  Map as MapIcon,
  // resource categories
  Route,
  Library as LibraryIcon,
  Puzzle,
  ScrollText,
  Download,
  MapPin,
  // misc
  Sparkles,
} from "lucide-react";

/**
 * Central professional-icon registry. One canonical, on-brand line-icon set
 * (lucide-react) used everywhere across the public site + admin portal so we
 * never mix emoji glyphs with SVG icons. Extend by adding a key here and
 * referencing it from a nav/category config — no render-site changes needed.
 *
 * Mirrors the existing `components/public/ca/CaIcons.tsx` convention.
 */
export const APP_ICONS = {
  // Student navigation
  dashboard: LayoutDashboard,
  home: Home,
  courses: GraduationCap,
  feed: Newspaper,
  live: Radio,
  tests: FlaskConical,
  quizzes: ClipboardCheck,
  material: BookOpen,
  mentorship: Handshake,
  bookmarks: Star,
  fees: CreditCard,
  profile: User,

  // Admin navigation
  analytics: BarChart3,
  revenue_analytics: LineChart,
  learning: BookText,
  toppers: Medal,
  navigation: Compass,
  about: BookMarked,
  leads: Target,
  forms: ClipboardList,
  landing: Rocket,
  marketing: Megaphone,
  referrals: Gift,
  careers: Briefcase,
  ai_agent: Bot,
  sms: Smartphone,
  brochures: FolderOpen,
  webinars: Video,
  content: Library,
  resources: BookOpen,
  qa: MessageSquare,
  plans: Gem,
  pdf_library: FileText,
  question_bank: HelpCircle,
  quiz_tests: ListChecks,
  reports: LineChart,
  imports: FileStack,
  leaderboard: Trophy,
  students: Users,
  duplicates: Shuffle,
  payments: Wallet,
  seats: Armchair,
  fees_risk: AlertTriangle,
  access_risk: Clock,
  at_risk: ShieldAlert,
  staff: UserCog,
  settings: Settings,

  // Content types (contentMeta)
  current_affairs: Newspaper,
  mcq: PenLine,
  booklet: BookCopy,
  recording: Video,
  live_link: Radio,
  pyq: FileStack,
  test_series: FlaskConical,
  answer_writing: PenLine,
  notes: StickyNote,
  maps: MapIcon,

  // Resource categories (resourceConstants)
  beginner: Route,
  strategy: Target,
  books: LibraryIcon,
  syllabus: Compass,
  optional: Puzzle,
  prelims: ClipboardCheck,
  mains: PenLine,
  notes_pdf: Download,
  local: MapPin,

  // Homepage / misc accents
  batch: Users,
  faculty: GraduationCap,
  offline: MapPin,
  online: Video,
  hybrid: Shuffle,
  telegram: Radio,
  guide: ScrollText,
  sparkle: Sparkles,
  download: Download,
  document: FileText,
} satisfies Record<string, LucideIcon>;

export type AppIconKey = keyof typeof APP_ICONS;

/** Resolve an icon key to a lucide icon, falling back to a neutral document. */
export function appIcon(key: string | null | undefined): LucideIcon {
  return (key && (APP_ICONS as Record<string, LucideIcon>)[key]) || FileText;
}

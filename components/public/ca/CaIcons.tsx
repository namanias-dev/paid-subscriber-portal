import type { LucideIcon } from "lucide-react";
import {
  Landmark,
  TrendingUp,
  Leaf,
  FlaskConical,
  Globe,
  Shield,
  Users,
  Map,
  ScrollText,
  Scale,
  ClipboardList,
  BarChart3,
  Gavel,
  FileText,
  BookOpen,
} from "lucide-react";

/** Category slug → line icon. Falls back to BookOpen. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "polity-governance": Landmark,
  economy: TrendingUp,
  environment: Leaf,
  "science-tech": FlaskConical,
  "international-relations": Globe,
  security: Shield,
  "social-issues": Users,
  geography: Map,
  "history-culture": ScrollText,
  ethics: Scale,
  schemes: ClipboardList,
  "reports-indices": BarChart3,
  judiciary: Gavel,
  "parliament-bills-acts": FileText,
};

export function categoryIcon(slug: string | null | undefined): LucideIcon {
  return (slug && CATEGORY_ICONS[slug]) || BookOpen;
}

/** A glassy/gold rounded icon chip wrapping any lucide icon. */
export function CaIconChip({
  icon: Icon,
  variant = "dark",
  size = 22,
  className = "",
}: {
  icon: LucideIcon;
  variant?: "dark" | "light";
  size?: number;
  className?: string;
}) {
  return (
    <span className={`ca-icon-chip ${variant === "light" ? "ca-icon-chip--light" : ""} ${className}`}>
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

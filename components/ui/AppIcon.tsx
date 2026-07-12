import { appIcon } from "@/lib/appIcons";

/**
 * Renders a professional lucide icon from the central registry by key.
 * Safe in both server and client components (pure SVG, no hooks).
 */
export default function AppIcon({
  name,
  size = 18,
  strokeWidth = 1.75,
  className = "",
}: {
  name: string | null | undefined;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const Icon = appIcon(name);
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}

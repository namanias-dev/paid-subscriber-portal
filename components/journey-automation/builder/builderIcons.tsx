"use client";

import {
  Zap, IndianRupee, CalendarClock, CalendarCheck, UserPlus, CircleX, FileUp,
  GraduationCap, Video, VideoOff, GitBranch, Timer, MessageSquare, ClipboardList,
  Split, Target, OctagonMinus, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  Zap, IndianRupee, CalendarClock, CalendarCheck, UserPlus, CircleX, FileUp,
  GraduationCap, Video, VideoOff, GitBranch, Timer, MessageSquare, ClipboardList,
  Split, Target, OctagonMinus,
};

export function BuilderIcon({ name, size = 16, strokeWidth = 2, className, color }: { name: string; size?: number; strokeWidth?: number; className?: string; color?: string }) {
  const Icon = MAP[name] ?? Zap;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} color={color} aria-hidden="true" />;
}

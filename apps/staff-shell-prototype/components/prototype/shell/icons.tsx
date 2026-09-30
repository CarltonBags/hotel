import {
  LayoutDashboard, CalendarDays, LogIn, Sparkles, Tag, MessageCircle, ChartColumn, User, ClipboardList, List, DoorOpen, Wallet, Users, Settings,
  type LucideIcon,
} from "lucide-react";
import type { TabKind } from "./mock";

export const KIND_ICON: Record<TabKind, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  arrivals: LogIn,
  housekeeping: Sparkles,
  rates: Tag,
  inbox: MessageCircle,
  reports: ChartColumn,
  reservation: ClipboardList,
  guest: User,
  list: List,
};

export const MENU_ICON: Record<string, LucideIcon> = { DoorOpen, List, Wallet, Tag, Users, Sparkles, ChartColumn, Settings };

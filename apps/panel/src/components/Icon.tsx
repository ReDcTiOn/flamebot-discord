import {
  Coins,
  Hash,
  House,
  LayoutDashboard,
  List,
  MessageSquare,
  Shield,
  Store,
  ThumbsUp,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/modules";

const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  trending: TrendingUp,
  thumb: ThumbsUp,
  store: Store,
  users: Users,
  hash: Hash,
  message: MessageSquare,
  coin: Coins,
  shield: Shield,
  list: List,
  home: House,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Component = ICONS[name];
  return <Component size={size} aria-hidden="true" strokeWidth={1.8} />;
}

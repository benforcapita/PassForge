import {
  Ambulance,
  Archive,
  BedDouble,
  Beer,
  Bell,
  Binoculars,
  Bomb,
  Box,
  Briefcase,
  Bug,
  Bus,
  Cake,
  Camera,
  Car,
  ChartArea,
  Circle,
  CircleAlert,
  Cloud,
  Coffee,
  Coins,
  Database,
  Diamond,
  Eye,
  Flag,
  FlaskConical,
  Gamepad2,
  Gem,
  GraduationCap,
  Hash,
  Heart,
  Hotel,
  MessageSquare,
  Plane,
  Plug,
  Rocket,
  Ship,
  ShoppingCart,
  TramFront,
  Truck,
  University,
  UtensilsCrossed,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import type { Finger } from "../../types";

const ICON_MAP: Record<string, LucideIcon> = {
  "fa-hashtag": Hash,
  "fa-heart": Heart,
  "fa-hotel": Hotel,
  "fa-university": University,
  "fa-plug": Plug,
  "fa-ambulance": Ambulance,
  "fa-bus": Bus,
  "fa-car": Car,
  "fa-plane": Plane,
  "fa-rocket": Rocket,
  "fa-ship": Ship,
  "fa-subway": TramFront,
  "fa-truck": Truck,
  "fa-jpy": Coins,
  "fa-eur": Coins,
  "fa-btc": Coins,
  "fa-usd": Coins,
  "fa-gbp": Coins,
  "fa-archive": Archive,
  "fa-area-chart": ChartArea,
  "fa-bed": BedDouble,
  "fa-beer": Beer,
  "fa-bell": Bell,
  "fa-binoculars": Binoculars,
  "fa-birthday-cake": Cake,
  "fa-bomb": Bomb,
  "fa-briefcase": Briefcase,
  "fa-bug": Bug,
  "fa-camera": Camera,
  "fa-cart-plus": ShoppingCart,
  "fa-certificate": Gem,
  "fa-coffee": Coffee,
  "fa-cloud": Cloud,
  "fa-comment": MessageSquare,
  "fa-cube": Box,
  "fa-cutlery": UtensilsCrossed,
  "fa-database": Database,
  "fa-diamond": Diamond,
  "fa-exclamation-circle": CircleAlert,
  "fa-eye": Eye,
  "fa-flag": Flag,
  "fa-flask": FlaskConical,
  "fa-futbol-o": Volleyball,
  "fa-gamepad": Gamepad2,
  "fa-graduation-cap": GraduationCap,
};

export function fingerprintIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Circle;
}

type Props = {
  fingers: Finger[] | null | undefined;
  size?: number;
};

export function FingerprintGlyphs({ fingers, size = 14 }: Props) {
  if (!fingers || fingers.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {fingers.map((finger, i) => {
        const Icon = fingerprintIcon(finger.icon);
        return (
          <Icon
            key={i}
            size={size}
            strokeWidth={1.5}
            style={{ color: finger.color }}
            aria-hidden
          />
        );
      })}
    </span>
  );
}

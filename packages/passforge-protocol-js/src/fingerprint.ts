// Port of build_fingerprint_hash + create_fingerprint (lesspass-core): three
// coloured glyphs that tell the user they typed their master password right.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const ICONS = [
  "fa-hashtag", "fa-heart", "fa-hotel", "fa-university", "fa-plug", "fa-ambulance", "fa-bus",
  "fa-car", "fa-plane", "fa-rocket", "fa-ship", "fa-subway", "fa-truck", "fa-jpy", "fa-eur",
  "fa-btc", "fa-usd", "fa-gbp", "fa-archive", "fa-area-chart", "fa-bed", "fa-beer", "fa-bell",
  "fa-binoculars", "fa-birthday-cake", "fa-bomb", "fa-briefcase", "fa-bug", "fa-camera",
  "fa-cart-plus", "fa-certificate", "fa-coffee", "fa-cloud", "fa-comment", "fa-cube",
  "fa-cutlery", "fa-database", "fa-diamond", "fa-exclamation-circle", "fa-eye", "fa-flag",
  "fa-flask", "fa-futbol-o", "fa-gamepad", "fa-graduation-cap",
] as const;

const COLORS = [
  "#000000", "#074750", "#009191", "#FF6CB6", "#FFB5DA", "#490092", "#006CDB", "#B66DFF",
  "#6DB5FE", "#B5DAFE", "#920000", "#924900", "#DB6D00", "#24FE23",
] as const;

export type Finger = { icon: (typeof ICONS)[number]; color: (typeof COLORS)[number] };

export function createFingerprint(masterPassword: string): Finger[] {
  const key = utf8ToBytes(masterPassword);
  const hash = bytesToHex(hmac(sha256, key, key));
  return [0, 6, 12].map((start) => {
    const n = parseInt(hash.slice(start, start + 6), 16);
    return { icon: ICONS[n % ICONS.length], color: COLORS[n % COLORS.length] };
  });
}

// Architecture rule: the extension is severed from the algorithm. The built
// bundle must contain no derivation symbols — passwords come only from the
// local backend. Runs after `yarn build` (skipped when dist/ is absent).
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = join(__dirname, "..", "dist");
const BANNED = /pbkdf2|calc_entropy|render_password|renderPassword|passforge-finish-v1/i;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("severance", () => {
  it("dist bundle contains no derivation code", () => {
    const all = files(DIST).filter((f) => /\.(js|html)$/.test(f));
    if (all.length === 0) {
      console.warn("dist/ not built — run `yarn build` first; skipping");
      return;
    }
    for (const file of all) {
      expect(BANNED.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });
});

// Exact port of crates/lesspass-core/src/render.rs (the LessPass renderer).
// It only turns entropy into characters; the entropy itself must come from
// `finishEntropy`, i.e. from an algorithm server.

export type PasswordOptions = {
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  length: number;
};

const SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
} as const;

type Rule = keyof typeof SETS;
const RULE_ORDER: Rule[] = ["lowercase", "uppercase", "digits", "symbols"];

function consumeEntropy(
  generated: string,
  quotient: bigint,
  charset: string,
  maxLength: number,
): [string, bigint] {
  const len = BigInt(charset.length);
  while (generated.length < maxLength) {
    generated += charset[Number(quotient % len)];
    quotient /= len;
  }
  return [generated, quotient];
}

function insertPseudoRandomly(initial: string, entropy: bigint, toInsert: string): string {
  let result = initial;
  let consumed = entropy;
  for (const ch of toInsert) {
    if (result.length === 0) {
      result += ch;
      continue;
    }
    const len = BigInt(result.length);
    const pos = Number(consumed % len);
    result = result.slice(0, pos) + ch + result.slice(pos);
    consumed /= len;
  }
  return result;
}

export function renderPassword(entropyHex: string, options: PasswordOptions): string {
  const rules = RULE_ORDER.filter((rule) => options[rule]);
  if (options.length < rules.length) {
    throw new Error(
      `password length ${options.length} cannot fit ${rules.length} required character rules`,
    );
  }
  const charset =
    rules.length === 0 ? RULE_ORDER.map((r) => SETS[r]).join("") : rules.map((r) => SETS[r]).join("");
  const entropy = /^[0-9a-fA-F]+$/.test(entropyHex) ? BigInt(`0x${entropyHex}`) : 0n;

  const [generated, remaining] = consumeEntropy("", entropy, charset, options.length - rules.length);
  let consumed = remaining;
  let oneCharPerRule = "";
  for (const rule of rules) {
    const [value, next] = consumeEntropy("", consumed, SETS[rule], 1);
    oneCharPerRule += value;
    consumed = next;
  }
  return insertPseudoRandomly(generated, consumed, oneCharPerRule);
}

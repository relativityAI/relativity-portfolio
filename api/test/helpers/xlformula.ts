/**
 * Minimal Excel formula evaluator — test-only.
 *
 * Its one job: prove that the formula written into each cell computes the same
 * number the DCF model cached as its result. If these ever diverge, a user edits
 * an assumption in the workbook and watches the value jump. A general evaluator
 * (hyperformula etc.) would be a dependency used nowhere else.
 *
 * Supports exactly the syntax the recipe builders emit: + - * / ^, comparisons,
 * parentheses, cell refs (with $ and Sheet! prefixes), ranges in SUM, and the
 * IF / ISNUMBER / N / SUM functions.
 */

export class UnresolvedRef extends Error {}

type Value = string | number | boolean | null | undefined;

interface Ref {
  sheet: string | null;
  ref: string;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly src: string,
    private readonly resolve: (sheet: string | null, ref: string) => Value,
    private readonly defaultSheet: string | null,
  ) {}

  static evaluate(formula: string, resolve: (sheet: string | null, ref: string) => Value, defaultSheet: string | null): Value {
    return new Parser(formula, resolve, defaultSheet).parseAll();
  }

  private parseAll(): Value {
    const v = this.comparison();
    this.skipSpace();
    if (this.pos < this.src.length) throw new Error(`unparsed tail "${this.src.slice(this.pos)}" in "${this.src}"`);
    return v;
  }

  private skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private eat(token: string): boolean {
    this.skipSpace();
    if (this.src.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  private comparison(): Value {
    let left = this.additive();
    for (;;) {
      this.skipSpace();
      const op = ["<>", "<=", ">=", "=", "<", ">"].find((t) => this.src.startsWith(t, this.pos));
      if (!op) return left;
      this.pos += op.length;
      const right = this.additive();
      const [a, b] = [left, right] as number[];
      switch (op) {
        case "=": left = a === b; break;
        case "<>": left = a !== b; break;
        case "<": left = a < b; break;
        case "<=": left = a <= b; break;
        case ">": left = a > b; break;
        default: left = a >= b; break;
      }
    }
  }

  private additive(): Value {
    let left = this.multiplicative();
    for (;;) {
      if (this.eat("+")) left = num(left) + num(this.multiplicative());
      else if (this.eat("-")) left = num(left) - num(this.multiplicative());
      else return left;
    }
  }

  private multiplicative(): Value {
    let left = this.unary();
    for (;;) {
      if (this.eat("*")) left = num(left) * num(this.unary());
      else if (this.eat("/")) left = num(left) / num(this.unary());
      else return left;
    }
  }

  private unary(): Value {
    if (this.eat("-")) return -num(this.unary());
    if (this.eat("+")) return num(this.unary());
    return this.power();
  }

  private power(): Value {
    const base = num(this.primary());
    if (this.eat("^")) return base ** this.unary(); // right-associative
    return base;
  }

  private primary(): Value {
    this.skipSpace();
    const ch = this.src[this.pos];

    if (ch === "(") {
      this.pos++;
      const v = this.comparison();
      if (!this.eat(")")) throw new Error(`missing ) in "${this.src}"`);
      return v;
    }
    if (ch === '"') {
      const end = this.src.indexOf('"', this.pos + 1);
      if (end < 0) throw new Error(`unterminated string in "${this.src}"`);
      const text = this.src.slice(this.pos + 1, end);
      this.pos = end + 1;
      return text;
    }

    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }

    const fn = /^[A-Za-z]+(?=\()/.exec(this.src.slice(this.pos));
    if (fn) {
      this.pos += fn[0].length;
      this.pos++; // (
      switch (fn[0].toUpperCase()) {
        case "IF": {
          const cond = this.comparison();
          if (!this.eat(",")) throw new Error(`IF needs 3 args in "${this.src}"`);
          const then = this.comparison();
          if (!this.eat(",")) throw new Error(`IF needs 3 args in "${this.src}"`);
          const otherwise = this.comparison();
          if (!this.eat(")")) throw new Error(`missing ) in "${this.src}"`);
          return cond ? then : otherwise;
        }
        case "ISNUMBER": {
          const v = this.comparison();
          if (!this.eat(")")) throw new Error(`missing ) in "${this.src}"`);
          return typeof v === "number";
        }
        case "AND": {
          const values = this.argList("AND");
          return values.every(Boolean);
        }
        case "OR": {
          const values = this.argList("OR");
          return values.some(Boolean);
        }
        case "N": {
          const v = this.comparison();
          if (!this.eat(")")) throw new Error(`missing ) in "${this.src}"`);
          return typeof v === "number" ? v : 0;
        }
        case "SUM": {
          const values: Value[] = [];
          for (;;) {
            values.push(...this.sumArgs());
            if (!this.eat(",")) break;
          }
          if (!this.eat(")")) throw new Error(`missing ) in "${this.src}"`);
          return values.reduce<number>((s, v) => s + num(v), 0);
        }
        default:
          throw new Error(`unsupported function ${fn[0]} in "${this.src}"`);
      }
    }

    const ref = this.reference();
    if (!ref) throw new Error(`cannot parse "${this.src}" at ${this.pos}`);
    return this.resolve(ref.sheet, ref.ref);
  }

  /** N args then a closing paren, e.g. AND(a, b, c). */
  private argList(name: string): Value[] {
    const values: Value[] = [];
    for (;;) {
      values.push(this.comparison());
      if (!this.eat(",")) break;
    }
    if (!this.eat(")")) throw new Error(`${name} is missing ) in "${this.src}"`);
    return values;
  }

  /** SUM takes either single cells or an A1:B2 range. */
  private sumArgs(): Value[] {
    const first = this.reference();
    if (!first) throw new Error(`SUM expects a reference in "${this.src}"`);
    if (!this.eat(":")) return [this.resolve(first.sheet, first.ref)];
    const last = this.reference();
    if (!last) throw new Error(`SUM range is missing its end in "${this.src}"`);
    const sheet = first.sheet ?? last.sheet ?? this.defaultSheet;
    const out: Value[] = [];
    const [c1, r1] = parseRef(first.ref);
    const [c2, r2] = parseRef(last.ref);
    for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
      for (let row = Math.min(r1, r2); row <= Math.max(r1, r2); row++) {
        out.push(this.resolve(sheet, `${colName(col)}${row}`));
      }
    }
    return out;
  }

  /** `'Sheet Name'!$B$7`, `Inputs!B7`, or bare `B7`. */
  private reference(): Ref | null {
    this.skipSpace();
    const rest = this.src.slice(this.pos);

    const quoted = /^'([^']+)'!/.exec(rest);
    let sheet: string | null = null;
    let offset = 0;
    if (quoted) {
      sheet = quoted[1]!;
      offset = quoted[0].length;
    } else {
      const bare = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
      if (bare) {
        sheet = bare[1]!;
        offset = bare[0].length;
      }
    }

    const cell = /^\$?([A-Za-z]{1,3})\$?([0-9]+)/.exec(rest.slice(offset));
    if (!cell) return null;
    this.pos += offset + cell[0].length;
    return { sheet, ref: `${cell[1]!.toUpperCase()}${cell[2]}` };
  }
}

const num = (v: Value): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : v == null || v === "" ? 0 : Number(v));

const colName = (n: number): string => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};

const parseRef = (ref: string): [number, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [col, Number(m[2])];
};

/** Evaluate `formula` against `cells` keyed as `Sheet!Ref`, defaulting sheet to `defaultSheet`. */
export function evaluateFormula(
  formula: string,
  cells: Map<string, Value>,
  defaultSheet: string | null = null,
): Value {
  return Parser.evaluate(
    formula,
    (sheet, ref) => {
      const key = `${sheet ?? defaultSheet}!${ref}`;
      const v = cells.get(key);
      if (v === undefined) throw new UnresolvedRef(key);
      return v;
    },
    defaultSheet,
  );
}

/**
 * Resolve every formula cell in a recipe to a fixpoint, then hand each
 * `(key, formula, cachedResult)` to `compare`.
 */
export function verifyRecipe(
  sheets: { name: string; cells: { ref: string; value?: Value; formula?: string; result?: Value }[] }[],
  compare: (key: string, computed: Value, cached: Value) => void,
  maxPasses = 12,
): void {
  const resolved = new Map<string, Value>();
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell.formula && cell.value !== null && cell.value !== undefined) resolved.set(`${sheet.name}!${cell.ref}`, cell.value);
    }
  }

  const pending = sheets.flatMap((s) =>
    s.cells.filter((c) => c.formula).map((c) => ({ key: `${s.name}!${c.ref}`, sheet: s.name, cell: c })),
  );

  let remaining = pending;
  for (let pass = 0; pass < maxPasses && remaining.length; pass++) {
    const next = [];
    for (const item of remaining) {
      try {
        const computed = evaluateFormula(item.cell.formula!, resolved, item.sheet);
        if (typeof item.cell.result === "number" && typeof computed === "number") {
          compare(item.key, computed, item.cell.result as number);
        }
        resolved.set(item.key, computed);
      } catch (err) {
        if (err instanceof UnresolvedRef) next.push(item);
        else throw new Error(`${item.key} = "${item.cell.formula}" failed: ${(err as Error).message}`);
      }
    }
    remaining = next;
  }

  if (remaining.length) {
    throw new Error(`could not resolve: ${remaining.map((r) => r.key).join(", ")}`);
  }
}
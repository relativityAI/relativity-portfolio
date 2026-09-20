import { AgentService } from "@/db";

// Section-scoped Markdown: a read/replace affordance per section, so the form
// and the markdown are two views of the same agent object instead of parallel
// copies. Round-trips through the same AgentService.validateMd the backend owns.

export interface MdIssue {
    line: number;
    message: string;
    severity: "warn" | "error";
}

// Loosely-typed on purpose: the backend owns the real schema; we only touch the
// fields this module round-trips.
export type AgentShape = Record<string, any>;

export const MD_SECTIONS = ["configuration", "persona", "asset_evaluation", "macro_evaluation"] as const;
export type MdSection = (typeof MD_SECTIONS)[number];

const SECTION_TITLES: Record<Exclude<MdSection, "configuration">, string> = {
    persona: "Philosophy",
    asset_evaluation: "Asset Evaluation",
    macro_evaluation: "Macro Evaluation",
};

const OP_TO_SYM: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between" };
const SYM_TO_OP: Record<string, string> = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "=": "eq" };

function docStub(agent: AgentShape): string {
    const horizon = agent.configuration?.investment_horizon || "";
    const risk = agent.configuration?.risk_appetite ?? 5;
    return [
        "---",
        `name: ${agent.name || "Untitled agent"}`,
        horizon ? `investment_horizon: ${horizon}` : "",
        `risk_appetite: ${risk}`,
        "---",
    ].filter(Boolean).join("\n");
}

function qualToMd(items: any[]): string {
    if (!items?.length) return "";
    const blocks = items.map((p) =>
        `#### ${p.parameter || "Untitled"} — weight ${p.weightage ?? 5}\n\n${(p.content || "").trim()}`.trim()
    );
    return blocks.join("\n\n");
}

function quantToMd(items: any[]): string {
    if (!items?.length) return "";
    const rows = items.map((r) => {
        const name = r.metric_name || r.metric || "metric";
        const sym = OP_TO_SYM[r.operator] || r.operator;
        const val = Array.isArray(r.value)
            ? `between ${r.value[0]} and ${r.value[1]}`
            : `${sym} ${r.value}`;
        return `| ${name} | ${val} | ${r.weightage ?? 5} |`;
    }).join("\n");
    return ["| Metric | Rule | Weight |", "|---|---|---|", rows].join("\n");
}

export function sectionToMarkdown(step: string, agent: AgentShape): string {
    switch (step) {
        case "configuration":
            return docStub(agent);
        case "persona":
            return `## Philosophy\n\n${(agent.persona?.philosophy_and_mindset || "").trim()}`.trimEnd();
        case "asset_evaluation":
        case "macro_evaluation": {
            const q = step === "asset_evaluation" ? agent.asset_evaluation?.qualitative : agent.macro_evaluation?.qualitative;
            const qt = step === "asset_evaluation" ? agent.asset_evaluation?.quantitative : agent.macro_evaluation?.quantitative;
            const qual = qualToMd(q);
            const quant = quantToMd(qt);
            const blocks = [`## ${SECTION_TITLES[step]}`];
            if (qual) blocks.push("### Qualitative", qual);
            if (quant) blocks.push("### Quantitative", quant);
            return blocks.join("\n\n");
        }
        default:
            return "";
    }
}

/** Build a full document the backend validate-md understands. */
function fullDoc(step: string, md: string, agent: AgentShape): string {
    if (step === "configuration") return md;
    return `${docStub(agent)}\n\n${md}`;
}

/** Validate a section via the same endpoint form-mode uses. */
export async function validateSection(step: string, md: string, agent: AgentShape): Promise<MdIssue[]> {
    try {
        const res = await AgentService.validateMd(fullDoc(step, md, agent));
        return res.issues || [];
    } catch {
        return [];
    }
}

export type ParseResult =
    | { ok: true; merged: Partial<AgentShape> }
    | { ok: false; issues: string[] };

function parseFrontmatter(md: string): { merged: Partial<AgentShape>; issues: string[] } {
    const merged: Partial<AgentShape> = { configuration: {}, persona: {} };
    const issues: string[] = [];
    const m = md.trim().match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return { merged: {}, issues: ["Missing frontmatter (--- key: value ---) block."] };
    for (const line of m[1].split("\n")) {
        const [k, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        if (!k.trim() || !value) continue;
        const key = k.trim();
        if (key === "name") merged.name = value;
        else if (key === "investment_horizon") (merged.configuration as any).investment_horizon = value;
        else if (key === "risk_appetite") {
            const n = Number(value);
            if (Number.isFinite(n)) (merged.configuration as any).risk_appetite = n;
            else issues.push(`risk_appetite must be a number, got "${value}".`);
        }
    }
    return { merged, issues };
}

/** Block: `#### Name — weight 5` followed by a paragraph. */
function parseQualitative(text: string): { items: any[]; issues: string[] } {
    const items: any[] = [];
    const issues: string[] = [];
    const lines = text.split("\n");
    let current: any = null;
    let inHeading = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (/^#{4,}\s+/.test(line)) {
            inHeading = true;
            const body = line.replace(/^#{4,}\s+/, "");
            const hm = body.match(/^(.+?)\s*—\s*weight\s+(\d+(?:\.\d+)?)\s*$/i);
            if (hm) {
                current = { parameter: hm[1].trim(), content: "", weightage: Number(hm[2]) };
                items.push(current);
            } else {
                issues.push(`Unrecognised qualitative heading: "${line}". Expected "#### Name — weight N".`);
                current = null;
            }
        } else if (/^#{2,3}\s+/.test(line)) {
            inHeading = false;
            current = null;
        } else if (!inHeading && items.length === 0 && current === null) {
            issues.push(`Unexpected text outside a "#### Name — weight N" block: "${line}".`);
        } else if (current) {
            current.content = current.content ? `${current.content}\n${line}` : line;
        }
    }
    return { items, issues };
}

/** Table: `| Metric | Rule | Weight |` with `| ROE | > 20 | 8 |` rows. */
function parseQuantitative(text: string): { items: any[]; issues: string[] } {
    const items: any[] = [];
    const issues: string[] = [];
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line.startsWith("|")) {
            if (line && !/^#{2,}/.test(line)) issues.push(`Unexpected text in quantitative table: "${line}".`);
            continue;
        }
        const cells = line.split("|").slice(1, -1).map((c) => c.trim()).filter((c, _i, arr) => c !== "" || arr.length === 1);
        if (cells.length < 3) continue; // header/separator rows `| Metric | Rule | Weight |` / `|---|---|---|`
        const [metric, ruleCell, weightCell] = cells;
        if (/^Metric\s*/i.test(metric) && /^Rule\s*/i.test(ruleCell)) continue;
        if (/^-{2,}/.test(metric) && /^-{2,}/.test(ruleCell)) continue;

        let operator = "";
        let value: number | number[] = NaN;
        const between = ruleCell.match(/\bbetween\s+(-?[\d.]+)\s+(?:and|-)\s+(-?[\d.]+)/i);
        if (between) {
            operator = "between";
            value = [Number(between[1]), Number(between[2])];
        } else {
            const rm = ruleCell.match(/^\s*(>=|<=|>|<|=)\s*(-?[\d.]+)\s*$/);
            if (rm) {
                operator = SYM_TO_OP[rm[1]] || rm[1];
                value = Number(rm[2]);
            } else {
                issues.push(`Unrecognised rule "${ruleCell}" for metric "${metric}". Use e.g. "> 20" or "between 10 and 20".`);
                continue;
            }
        }
        const weight = Number(weightCell);
        if (!Number.isFinite(weight)) {
            issues.push(`Weight "${weightCell}" for metric "${metric}" must be a number.`);
            continue;
        }
        items.push({ metric_name: metric, operator, value, weightage: weight });
    }
    return { items, issues };
}

/** Parse a section markdown back into agent fields. Strict: any unrecognised
 *  structure blocks the apply so the form never silently diverges. */
export function parseSection(step: stepUnion, md: string): ParseResult {
    const section = step as MdSection;
    switch (section) {
        case "configuration": {
            const { merged, issues } = parseFrontmatter(md);
            if (issues.length) return { ok: false, issues };
            return { ok: true, merged };
        }
        case "persona": {
            const body = md.replace(/^##\s+Philosophy\s*/i, "").trim();
            return body ? { ok: true, merged: { persona: { philosophy_and_mindset: body } } }
                : { ok: false, issues: ["Philosophy is empty."] };
        }
        case "asset_evaluation":
        case "macro_evaluation": {
            const key = section === "asset_evaluation" ? "asset_evaluation" : "macro_evaluation";
            const qual = md.match(/###\s+Qualitative\s*([\s\S]*?)(?=###\s+Quantitative|$)/i);
            const quant = md.match(/###\s+Quantitative\s*([\s\S]*)$/i);
            const q = parseQualitative(qual?.[1] || "");
            const qt = parseQuantitative(quant?.[1] || "");
            const issues = [...q.issues, ...qt.issues];
            if (issues.length) return { ok: false, issues };
            return { ok: true, merged: { [key]: { qualitative: q.items, quantitative: qt.items } } };
        }
        default:
            return { ok: false, issues: [`No editor for section "${step}".`] };
    }
}

type stepUnion = string;
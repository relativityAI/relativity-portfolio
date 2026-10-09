// Minimal LaTeX compile path with pdfmake fallback
// ponytail: reuse existing pdfmake when xelatex missing (TeX not guaranteed in prod image); upgrade when TeX bundled
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, symlink, readFile, readdir, copyFile, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { ReportBlock } from "./agent.js";
import { isUuid } from "./pdf.js";
import { LOGO_PNG_DATA_URI } from "./reportLogo.js";
import { NSE_LOGO_DATA_URI, SEC_LOGO_DATA_URI } from "./exchangeLogos.js";
import { tickerLogoDataUri } from "./tickerLogos.js";
import { chartBlockToPng } from "./pdf.js";

const nodeRequire = createRequire(import.meta.url);
const pdfMakeModule: any = nodeRequire("pdfmake/build/pdfmake.js");
const pdfFontsModule: any = nodeRequire("pdfmake/build/vfs_fonts.js");
const pdfMake: any = pdfMakeModule;
const pdfFonts: any = pdfFontsModule;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../templates/report");
const TEMPLATE_FILE = join(TEMPLATE_DIR, "report.tex");
const FONTS_DIR = join(TEMPLATE_DIR, "fonts");

function escLatex(s: string): string {
  return String(s || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\$/g, "\\$")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\textasciitilde{}");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function whichXelatex(): Promise<boolean> {
  for (const p of ["/usr/bin/xelatex", "/usr/local/bin/xelatex"]) {
    if (await fileExists(p)) return true;
  }
  return false;
}

async function compileLatex(tex: string): Promise<Buffer> {
  const tmp = await mkdtemp(join(tmpdir(), "report-"));
  await (await import("node:fs/promises")).mkdir(join(tmp, "fonts"));
  try {
    await symlink(FONTS_DIR, join(tmp, "fonts"));
  } catch {
    // copy files
  }
  try {
    const files = await readdir(FONTS_DIR);
    for (const f of files) {
      await copyFile(join(FONTS_DIR, f), join(tmp, "fonts", f)).catch(() => {});
    }
  } catch {}
  await writeFile(join(tmp, "report.tex"), tex, "utf8");
  async function runXe(outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn("/usr/bin/xelatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", outDir, join(tmp, "report.tex")], { cwd: tmp });
      let out = "";
      p.stdout?.on("data", (d) => (out += d.toString()));
      p.stderr?.on("data", (d) => (out += d.toString()));
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`xelatex ${code}\n${out}`))));
    });
  }
  await runXe(tmp);
  await runXe(tmp);
  const buf = await readFile(join(tmp, "report.pdf"));
  await rm(tmp, { recursive: true, force: true });
  return buf;
}

function footerAgent(run: any): string {
  if (isUuid(run.agent_name)) return run.agent_display_name || "";
  return run.agent_name || "";
}

function buildLatexBody(run: any): string {
  const lines: string[] = [];
  const report = run.report || {};
  const blocks: ReportBlock[] = Array.isArray(report.blocks) ? report.blocks : [];
  const isSkillRun = run.run_mode === "skill";
  const total = run.total_score;
  const cov = run.coverage;
  const covPct = cov && cov.scored != null && cov.total != null && cov.total > 0 ? Math.round((cov.scored / cov.total) * 100) : null;

  lines.push("\\begin{center}");
  lines.push(`\\textbf{\\Large ${escLatex(run.share_name || run.symbol || "Equity Analysis")}}\\\\`);
  lines.push(`\\vspace{2pt}\\textcolor{muted}{${escLatex(run.symbol || "")}${run.source ? " · " + escLatex(run.source) : ""}}\\\\`);
  if (isSkillRun) {
    const skill = run.skill_outputs?.[0]?.skill_name || run.skill_id || "skill";
    lines.push(`\\vspace{2pt}\\textcolor{faint}{Skill run · ${escLatex(skill)}}\\\\`);
  }
  lines.push("\\end{center}\\vspace{6pt}");

  if (!isSkillRun && total != null) {
    lines.push(`\\cardbox{\\begin{center}\\textbf{\\huge ${Math.round(total)}}\\\\\\textcolor{muted}{Fit score}\\end{center}}\\vspace{6pt}`);
  }
  if (run.price_data === "unavailable") {
    lines.push(`\\softbox{ambersoft}{amber}{No live price feed for this instrument — valuation and technical criteria are shown as N/A.}\\vspace{4pt}`);
  }
  if (run.error) {
    lines.push(`\\softbox{ambersoft}{red}{Run error — ${escLatex(String(run.error).slice(0, 300))}}\\vspace{4pt}`);
  }
  if (covPct != null && covPct < 40) {
    lines.push(`\\softbox{ambersoft}{amber}{Only ${covPct}\\% of rubric scored. Review breakdowns below.}\\vspace{4pt}`);
  }

  if (!isSkillRun) {
    for (const b of blocks) {
      if (b.type === "heading") {
        const lvl = b.level || 2;
        if (lvl === 3) lines.push(`\\subsection*{${escLatex(b.text)}}`);
        else lines.push(`\\section*{${escLatex(b.text)}}`);
      } else if (b.type === "paragraph") {
        lines.push(`${escLatex(b.text)}\\par\\vspace{2pt}`);
      } else if (b.type === "callout") {
        const t = b.tone || "neutral";
        const col = t === "positive" ? "green" : t === "negative" ? "red" : t === "caution" ? "amber" : "muted";
        lines.push(`\\softbox{ambersoft}{${col}}{${escLatex(b.text)}}\\vspace{4pt}`);
      } else if (b.type === "quote") {
        lines.push(`\\textit{"${escLatex(b.text)}"}${b.attribution ? "\\\\\\textcolor{faint}{— " + escLatex(b.attribution) + "}" : ""}\\par\\vspace{4pt}`);
      } else if (b.type === "table") {
        const cols: any[] = (b as any).columns || [];
        const rows: any[] = (b as any).rows || [];
        if (cols.length > 0 && rows.length > 0) {
          const align = cols.map(() => "l").join("");
          lines.push(`\\begin{tabularx}{\\linewidth}{${align}}\\toprule`);
          lines.push(cols.map((c: any) => `\\textbf{${escLatex(c.header)}}`).join(" & ") + "\\\\\\midrule");
          for (const r of rows.slice(0, 10)) {
            const vals = cols.map((c: any) => escLatex(String(r[c.key] ?? "")));
            lines.push(vals.join(" & ") + "\\\\");
          }
          lines.push("\\bottomrule\\end{tabularx}\\vspace{6pt}");
        }
      }
    }
  } else {
    // Skill runs: render skill sections + reasoning trace
    const outputs: any[] = Array.isArray(run.skill_outputs) ? run.skill_outputs : [];
    const usable = outputs.filter((o) => o && (o.skill_id || o.skill_name));
    lines.push("\\section*{Skill reports}");
    usable.forEach((o, i) => {
      const score = o.score_0_100;
      const name = o.skill_name || o.skill_id || "Skill";
      lines.push(`\\clearpage\\subsection*{Skill ${String(i + 1).padStart(2, "0")} — ${escLatex(name)}}`);
      lines.push(`\\textcolor{faint}{Score: ${score != null ? score : "—"}${o.coverage != null ? ` · ${Math.round(o.coverage * 100)}\\% coverage` : ""}}\\\\`);
      if (o.error) {
        lines.push(`\\softbox{ambersoft}{red}{No real data — ${escLatex(String(o.error).slice(0, 300))}}\\vspace{4pt}`);
      }
      if (o.analysis) {
        for (const ln of String(o.analysis).split("\n")) {
          const t = ln.trim();
          if (t) lines.push(`${escLatex(t)}\\par\\vspace{2pt}`);
        }
      }
      for (const v of o.verdicts || []) {
        const detail = v.evidence || v.rationale;
        const label = v.verdict || "—";
        const col = label === "PASS" ? "green" : label === "FAIL" ? "red" : "muted";
        lines.push(`\\textcolor{${col}}{${escLatex(label)}} ${escLatex((v.anchor || v.checklist_id || "") + (detail ? " — " + String(detail).slice(0, 200) : ""))}\\\\`);
      }
      for (const f of o.findings || []) {
        const title = typeof f === "string" ? "" : f.title || "";
        const detail = typeof f === "string" ? f : f.detail || f.text || f.finding || "";
        if (title) lines.push(`\\textbf{${escLatex(title)}}\\\\`);
        if (detail) lines.push(`${escLatex(detail)}\\\\`);
      }
      for (const b of o.blocks || []) {
        if (b.kind === "table") {
          const ds = (o.datasets || []).find((d: any) => d.id === b.dataset_id);
          const cols: string[] = b.columns || (ds?.columns || []).map((c: any) => c.name) || [];
          const rows: any[] = (ds?.data || []).slice(-(b.last_n || 30));
          if (cols.length && rows.length) {
            if (b.title) lines.push(`\\textbf{${escLatex(b.title)}}\\\\`);
            const align = cols.map(() => "l").join("");
            lines.push(`\\begin{tabularx}{\\linewidth}{${align}}\\toprule`);
            lines.push(cols.map((c) => `\\textbf{${escLatex(c)}}`).join(" & ") + "\\\\\\midrule");
            for (const r of rows.slice(0, 10)) {
              lines.push(cols.map((c) => escLatex(String(r?.[c] ?? ""))).join(" & ") + "\\\\");
            }
            lines.push("\\bottomrule\\end{tabularx}\\vspace{6pt}");
          }
        }
      }
    });
    // Reasoning trace
    lines.push("\\clearpage\\section*{Reasoning trace}");
    const trace: any[] = Array.isArray(run.trace) ? run.trace : [];
    if (!trace.length) {
      lines.push("No reasoning trace was stored.\\par");
    } else {
      for (const ev of trace.slice(0, 80)) {
        if (ev.type === "thought" && ev.text) {
          lines.push(`\\textit{${escLatex(String(ev.text).slice(0, 500))}}\\par\\vspace{2pt}`);
        } else if (ev.type === "tool_call") {
          lines.push(`\\textcolor{teal}{${escLatex(ev.tool || "tool")}}\\\\`);
        } else if (ev.type === "tool_result") {
          lines.push(`\\textcolor{muted}{→ ${escLatex(ev.status || "OK")}}\\\\`);
        }
      }
    }
  }
  const fa = footerAgent(run);
  if (fa) {
    lines.push(`\\vspace{\\fill}\\begin{center}\\footnotesize\\textcolor{faint}{${escLatex(run.share_name || run.symbol || "")} · ${escLatex(fa)}}\\end{center}`);
  }
  return lines.join("\n");
}

async function buildLatexTex(run: any): Promise<string> {
  const body = buildLatexBody(run);
  const tex = await readFile(TEMPLATE_FILE, "utf8");
  return tex.replace("%%REPORT_BODY%%", body);
}

export async function buildReportPdf(run: any): Promise<Buffer> {
  if (!(await whichXelatex())) {
    // ponytail: reuse pdfmake when xelatex unavailable (TeX not bundled in prod)
    pdfMake.vfs = pdfFonts?.pdfMake?.vfs ?? pdfFonts ?? {};
    const { buildReportPdf: pdfmakeBuild } = await import("./pdf.js");
    return pdfmakeBuild(run);
  }
  const tex = await buildLatexTex(run);
  return compileLatex(tex);
}

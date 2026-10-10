import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { buildReportPdf } = await import('./src/latex.js');
const run = {
  symbol: 'PATANJALI', source: 'NSE', share_name: 'Patanjali Foods Limited',
  run_mode: 'skill',
  skill_outputs: [{
    skill_id: 'growth-analysis', skill_name: 'Growth Analysis',
    score_0_100: 68, coverage: 0.85,
    analysis: 'Revenue grew 12% YoY with improving margins.\n\nKey drivers: premiumisation and distribution expansion.',
    verdicts: [
      { anchor: 'Revenue growth > 10%', verdict: 'PASS', evidence: '12% YoY' },
      { anchor: 'Margin expansion', verdict: 'FAIL', evidence: 'Flat margins' },
    ],
    findings: [{ title: 'Strong distribution', detail: 'Added 5000 new outlets in FY24' }],
    blocks: [{ kind: 'table', title: 'Financial Summary', columns: ['Metric', 'FY24', 'FY23'], dataset_id: 'fin' }],
    datasets: [{ id: 'fin', columns: [{name:'Metric'},{name:'FY24'},{name:'FY23'}], data: [{Metric:'Revenue', FY24:'12000', FY23:'10700'}] }],
  }],
  trace: [
    { type: 'thought', text: 'Analyzing revenue growth trajectory...' },
    { type: 'tool_call', tool: 'fetch_financials' },
    { type: 'tool_result', status: 'OK' },
  ],
};
const buf = await buildReportPdf(run);
writeFileSync('/tmp/skill.pdf', buf);
console.log('size:', buf.length);
try {
  const txt = execFileSync('pdftotext', ['/tmp/skill.pdf', '-'], { encoding: 'utf8', maxBuffer: 1024*1024 });
  console.log('---TEXT---');
  console.log(txt.slice(0, 800));
} catch(e) { console.log('pdftotext error:', e.message); }

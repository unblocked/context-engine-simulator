import fs from "node:fs";
import path from "node:path";
import type { AgentResult, ContextAttribution, ExperimentResult } from "./types.js";
import { estimateTokens, formatCost, formatDuration, formatTokens } from "./util.js";

function pctChange(baseline: number, enhanced: number): string {
  if (baseline === 0) return "N/A";
  const change = ((enhanced - baseline) / baseline) * 100;
  return `${change >= 0 ? "+" : ""}${Math.round(change)}%`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

function barWidth(value: number, max: number): number {
  return max === 0 ? 0 : Math.round((value / max) * 100);
}

function phaseRows(phases: { label: string; run: AgentResult; isContext?: boolean }[]): string {
  return phases.map(({ label, run, isContext }) => `
    <tr class="${isContext ? "context-phase" : ""}">
      <td>${isContext ? `<span class="ctx-badge">CTX</span> ` : ""}${label}</td>
      <td>${formatDuration(run.durationMs)}</td>
      <td>${formatCost(run.costUsd)}</td>
      <td>${isContext ? "~" + formatTokens(estimateTokens(run.result)) : formatTokens(run.outputTokens)}</td>
      <td>${run.numTurns}</td>
    </tr>
  `).join("");
}

function buildAttributionSection(attributions?: ContextAttribution[]): string {
  if (!attributions?.length) return "";

  const sorted = [...attributions].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, none: 3 };
    return (order[a.impact] ?? 3) - (order[b.impact] ?? 3);
  });

  const cards = sorted.map(a => {
    const gathered = Array.isArray(a.gathered) ? a.gathered : (a.gathered ? [String(a.gathered)] : []);
    const used = Array.isArray(a.used) ? a.used : (a.used ? [String(a.used)] : []);
    return `
    <div class="attr-card">
      <div class="attr-header">
        <span class="attr-category">${escapeHtml(a.category)}</span>
        <span class="attr-impact ${a.impact}">${a.impact} impact</span>
      </div>
      ${gathered.length ? `
        <div class="attr-sub">Gathered</div>
        <ul class="attr-list">${gathered.map(g => `<li>${escapeHtml(g)}</li>`).join("")}</ul>
      ` : ""}
      ${used.length ? `
        <div class="attr-sub">Used in Implementation</div>
        <ul class="attr-list used">${used.map(u => `<li>${escapeHtml(u)}</li>`).join("")}</ul>
      ` : `<div class="attr-sub" style="color: var(--text-muted); font-style: italic;">Not reflected in implementation</div>`}
    </div>`;
  }).join("");

  return `
  <div class="section">
    <div class="section-title">Where Context Came From</div>
    ${cards}
  </div>`;
}

export function writeHtmlReport(result: ExperimentResult, experimentDir: string): string {
  const b = result.baseline;
  const c = result.contextEnhanced;

  const bTaskMs = b.planRun.durationMs + b.reviewRun.durationMs + b.implementRun.durationMs;
  const bTaskCost = b.planRun.costUsd + b.reviewRun.costUsd + b.implementRun.costUsd;

  const cTaskMs = c.planRun.durationMs + c.reviewRun.durationMs + c.implementRun.durationMs;
  const cTaskCost = c.planRun.costUsd + c.reviewRun.costUsd + c.implementRun.costUsd;
  const cCtxMs = c.initialContextRun.durationMs + c.patternExtractionRun.durationMs + c.planContextRun.durationMs;
  const cCtxCost = c.initialContextRun.costUsd + c.patternExtractionRun.costUsd + c.planContextRun.costUsd;

  const hasEval = !!b.evaluation && !!c.evaluation;
  const scoreDiff = hasEval ? c.evaluation!.score - b.evaluation!.score : 0;
  const taskTimePct = pctChange(bTaskMs, cTaskMs);
  const taskCostPct = pctChange(bTaskCost, cTaskCost);

  const maxTime = Math.max(bTaskMs, cTaskMs, cCtxMs);
  const maxCost = Math.max(bTaskCost, cTaskCost);

  const timestamp = new Date().toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context Engine — Experiment Results</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --surface-2: #1a1a26;
    --border: #2a2a3a;
    --text: #e4e4ed;
    --text-muted: #8888a0;
    --accent: #7c3aed;
    --accent-light: #a78bfa;
    --accent-glow: rgba(124, 58, 237, 0.15);
    --green: #22c55e;
    --green-bg: rgba(34, 197, 94, 0.1);
    --red: #ef4444;
    --yellow: #eab308;
    --blue: #3b82f6;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
  }

  .container { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
  }
  .logo {
    width: 44px; height: 44px;
    background: linear-gradient(135deg, var(--accent), var(--accent-light));
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 22px; color: white;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--text), var(--accent-light));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 14px;
    margin-bottom: 40px;
  }
  .brand-tag {
    display: inline-block;
    background: var(--accent-glow);
    border: 1px solid rgba(124, 58, 237, 0.3);
    border-radius: 6px;
    padding: 2px 10px;
    font-size: 12px;
    color: var(--accent-light);
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  /* Hero metrics */
  .hero-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 40px;
  }
  .hero-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .hero-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent-light));
  }
  .hero-card.positive::before {
    background: linear-gradient(90deg, var(--green), #4ade80);
  }
  .hero-label {
    font-size: 13px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .hero-value {
    font-size: 48px;
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 6px;
  }
  .hero-value.positive { color: var(--green); }
  .hero-value.negative { color: var(--red); }
  .hero-value.neutral { color: var(--accent-light); }
  .hero-detail {
    font-size: 14px;
    color: var(--text-muted);
  }

  /* Comparison bars */
  .section { margin-bottom: 40px; }
  .section-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .section-title::before {
    content: '';
    width: 4px; height: 20px;
    background: var(--accent);
    border-radius: 2px;
  }

  .comparison-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .comp-label {
    font-size: 14px;
    color: var(--text-muted);
    text-align: right;
  }
  .bar-group { display: flex; flex-direction: column; gap: 6px; }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar-tag {
    font-size: 11px;
    font-weight: 600;
    width: 62px;
    text-align: right;
    flex-shrink: 0;
  }
  .bar-tag.baseline { color: var(--text-muted); }
  .bar-tag.context { color: var(--accent-light); }
  .bar-track {
    flex: 1;
    height: 28px;
    background: var(--surface-2);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }
  .bar-fill {
    height: 100%;
    border-radius: 6px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    transition: width 0.6s ease;
  }
  .bar-fill.baseline { background: rgba(136, 136, 160, 0.25); color: var(--text-muted); }
  .bar-fill.context { background: rgba(124, 58, 237, 0.3); color: var(--accent-light); }
  .bar-fill.overhead { background: rgba(234, 179, 8, 0.2); color: var(--yellow); }

  /* Score display */
  .score-comparison {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 24px;
    align-items: center;
    margin-bottom: 32px;
  }
  .score-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
  }
  .score-box.winner {
    border-color: var(--accent);
    box-shadow: 0 0 30px var(--accent-glow);
  }
  .score-arm {
    font-size: 13px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 12px;
  }
  .score-num {
    font-size: 64px;
    font-weight: 800;
    line-height: 1;
  }
  .score-max {
    font-size: 24px;
    color: var(--text-muted);
    font-weight: 400;
  }
  .score-arrow {
    font-size: 32px;
    color: var(--text-muted);
  }

  /* Phase table */
  .phase-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .phase-table th {
    text-align: left;
    padding: 10px 16px;
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
  }
  .phase-table td {
    padding: 10px 16px;
    border-bottom: 1px solid rgba(42, 42, 58, 0.5);
  }
  .phase-table tr:last-child td { border-bottom: none; }
  .phase-table .context-phase td {
    background: rgba(124, 58, 237, 0.05);
  }
  .ctx-badge {
    display: inline-block;
    background: var(--accent-glow);
    border: 1px solid rgba(124, 58, 237, 0.3);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    color: var(--accent-light);
    font-weight: 700;
    letter-spacing: 0.5px;
    vertical-align: middle;
  }

  .arm-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .arm-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .arm-name {
    font-weight: 700;
    font-size: 15px;
  }
  .arm-score {
    font-weight: 700;
    font-size: 15px;
    padding: 4px 12px;
    border-radius: 8px;
  }

  /* Context overhead callout */
  .overhead-callout {
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(234, 179, 8, 0.03));
    border: 1px solid rgba(234, 179, 8, 0.2);
    border-radius: 16px;
    padding: 24px 28px;
    margin-bottom: 40px;
  }
  .overhead-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--yellow);
    margin-bottom: 8px;
  }
  .overhead-body {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.7;
  }
  .overhead-stat {
    display: inline-block;
    font-weight: 700;
    color: var(--text);
  }

  /* Reasoning */
  .reasoning-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .reasoning-label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .reasoning-text {
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }

  /* Meta */
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 40px;
  }
  .meta-item {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
  }
  .meta-key { color: var(--text-muted); font-size: 13px; }
  .meta-val { font-weight: 600; font-size: 13px; }

  /* Attribution */
  .attr-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 12px;
  }
  .attr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .attr-category {
    font-weight: 700;
    font-size: 15px;
  }
  .attr-impact {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .attr-impact.high { background: rgba(34, 197, 94, 0.15); color: var(--green); }
  .attr-impact.medium { background: rgba(59, 130, 246, 0.15); color: var(--blue); }
  .attr-impact.low { background: rgba(234, 179, 8, 0.15); color: var(--yellow); }
  .attr-impact.none { background: rgba(136, 136, 160, 0.1); color: var(--text-muted); }
  .attr-sub {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    margin-top: 10px;
  }
  .attr-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .attr-list li {
    font-size: 13px;
    line-height: 1.6;
    padding: 2px 0;
    padding-left: 16px;
    position: relative;
  }
  .attr-list li::before {
    content: '›';
    position: absolute;
    left: 4px;
    color: var(--text-muted);
  }
  .attr-list.used li::before {
    content: '✓';
    color: var(--green);
    font-size: 11px;
  }

  /* Footer */
  .footer {
    text-align: center;
    padding-top: 32px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
  }
  .footer a { color: var(--accent-light); text-decoration: none; }

  /* Diff display */
  .diff-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: auto;
    max-height: 600px;
  }
  .diff-block pre {
    margin: 0;
    padding: 16px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    tab-size: 4;
  }
  .diff-block code { white-space: pre; }
  .diff-file { color: var(--accent-light); font-weight: 700; }
  .diff-meta { color: var(--text-muted); }
  .diff-hunk { color: var(--blue); }
  .diff-add { color: var(--green); background: rgba(34, 197, 94, 0.08); display: inline-block; width: 100%; }
  .diff-del { color: var(--red); background: rgba(239, 68, 68, 0.08); display: inline-block; width: 100%; }
  .diff-summary {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--text-muted);
  }
  .diff-summary .diff-added { color: var(--green); font-weight: 600; }
  .diff-summary .diff-removed { color: var(--red); font-weight: 600; }

  @media (max-width: 768px) {
    .hero-grid { grid-template-columns: 1fr; }
    .score-comparison { grid-template-columns: 1fr; }
    .score-arrow { transform: rotate(90deg); text-align: center; }
    .meta-grid { grid-template-columns: 1fr; }
    .comparison-row { grid-template-columns: 1fr; }
    .comp-label { text-align: left; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="logo">U</div>
    <h1>Context Engine</h1>
  </div>
  <div class="subtitle">
    Experiment Results &mdash; ${timestamp} &nbsp;
    <span class="brand-tag">Powered by Unblocked</span>
  </div>

  <!-- Meta -->
  <div class="meta-grid">
    <div class="meta-item">
      <span class="meta-key">Repository</span>
      <span class="meta-val">${path.basename(result.repoPath)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-key">Branch</span>
      <span class="meta-val">${result.branch}</span>
    </div>
    <div class="meta-item">
      <span class="meta-key">Agent</span>
      <span class="meta-val">${result.agent}</span>
    </div>
    <div class="meta-item">
      <span class="meta-key">Model</span>
      <span class="meta-val">${result.model}</span>
    </div>
    <div class="meta-item">
      <span class="meta-key">Duration</span>
      <span class="meta-val">${formatDuration(result.totalDurationMs)}</span>
    </div>
  </div>

  <!-- Task -->
  <div class="section">
    <div class="section-title">Task</div>
    <div class="reasoning-box">
      <div class="reasoning-text">${escapeHtml(result.task)}</div>
    </div>
  </div>

  ${result.criteria ? `
  <!-- Acceptance Criteria -->
  <div class="section">
    <div class="section-title">Acceptance Criteria</div>
    <div class="reasoning-box">
      <div class="reasoning-text">${escapeHtml(result.criteria)}</div>
    </div>
  </div>
  ` : ""}

  <!-- Hero Metrics -->
  <div class="hero-grid">
    ${hasEval ? `
    <div class="hero-card${scoreDiff > 0 ? " positive" : ""}">
      <div class="hero-label">Quality Improvement</div>
      <div class="hero-value${scoreDiff > 0 ? " positive" : scoreDiff < 0 ? " negative" : " neutral"}">
        ${scoreDiff > 0 ? "+" : ""}${scoreDiff}
      </div>
      <div class="hero-detail">${b.evaluation!.score} &rarr; ${c.evaluation!.score} out of 100</div>
    </div>` : ""}
    <div class="hero-card${cTaskMs < bTaskMs ? " positive" : ""}">
      <div class="hero-label">Task Speed</div>
      <div class="hero-value${cTaskMs < bTaskMs ? " positive" : " neutral"}">
        ${taskTimePct}
      </div>
      <div class="hero-detail">${formatDuration(bTaskMs)} &rarr; ${formatDuration(cTaskMs)}</div>
    </div>
    <div class="hero-card${cTaskCost < bTaskCost ? " positive" : ""}">
      <div class="hero-label">Task Cost</div>
      <div class="hero-value${cTaskCost < bTaskCost ? " positive" : " neutral"}">
        ${taskCostPct}
      </div>
      <div class="hero-detail">${formatCost(bTaskCost)} &rarr; ${formatCost(cTaskCost)}</div>
    </div>
  </div>

  ${hasEval ? `
  <!-- Quality Scores -->
  <div class="section">
    <div class="section-title">Quality Score</div>
    <div class="score-comparison">
      <div class="score-box">
        <div class="score-arm">Baseline</div>
        <div class="score-num" style="color: ${scoreColor(b.evaluation!.score)}">
          ${b.evaluation!.score}<span class="score-max">/100</span>
        </div>
      </div>
      <div class="score-arrow">&rarr;</div>
      <div class="score-box winner">
        <div class="score-arm">With Context</div>
        <div class="score-num" style="color: ${scoreColor(c.evaluation!.score)}">
          ${c.evaluation!.score}<span class="score-max">/100</span>
        </div>
      </div>
    </div>
  </div>
  ` : ""}

  <!-- Comparison Bars -->
  <div class="section">
    <div class="section-title">Head-to-Head</div>

    <div class="comparison-row">
      <div class="comp-label">Task Time</div>
      <div class="bar-group">
        <div class="bar-row">
          <span class="bar-tag baseline">Baseline</span>
          <div class="bar-track">
            <div class="bar-fill baseline" style="width: ${barWidth(bTaskMs, maxTime)}%">${formatDuration(bTaskMs)}</div>
          </div>
        </div>
        <div class="bar-row">
          <span class="bar-tag context">Context+</span>
          <div class="bar-track">
            <div class="bar-fill context" style="width: ${barWidth(cTaskMs, maxTime)}%">${formatDuration(cTaskMs)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="comparison-row">
      <div class="comp-label">Task Cost</div>
      <div class="bar-group">
        <div class="bar-row">
          <span class="bar-tag baseline">Baseline</span>
          <div class="bar-track">
            <div class="bar-fill baseline" style="width: ${barWidth(bTaskCost, maxCost)}%">${formatCost(bTaskCost)}</div>
          </div>
        </div>
        <div class="bar-row">
          <span class="bar-tag context">Context+</span>
          <div class="bar-track">
            <div class="bar-fill context" style="width: ${barWidth(cTaskCost, maxCost)}%">${formatCost(cTaskCost)}</div>
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Context Overhead Callout -->
  <div class="overhead-callout">
    <div class="overhead-title">Context Gathering Overhead</div>
    <div class="overhead-body">
      Three context-gathering phases added <span class="overhead-stat">${formatDuration(cCtxMs)}</span> and
      <span class="overhead-stat">${formatCost(cCtxCost)}</span> to the context-enhanced run.
      This upfront investment produced a context bundle of
      <span class="overhead-stat">~${formatTokens(estimateTokens(c.initialContextRun.result))} tokens</span>
      (initial) and
      <span class="overhead-stat">~${formatTokens(estimateTokens(c.planContextRun.result))} tokens</span>
      (plan-targeted), which the agent used to ${cTaskCost < bTaskCost ? "reduce task execution cost by " + pctChange(bTaskCost, cTaskCost).replace("+", "").replace("-", "") : "execute the task"}${scoreDiff > 0 ? " and improve quality by +" + scoreDiff + " points" : ""}.
    </div>
  </div>

  <!-- Context Attribution -->
  ${buildAttributionSection(c.contextAnalysis?.attributions)}

  <!-- Phase Breakdown: Baseline -->
  <div class="section">
    <div class="section-title">Phase Breakdown</div>

    <div class="arm-section">
      <div class="arm-header">
        <span class="arm-name">Baseline</span>
        ${b.evaluation ? `<span class="arm-score" style="background: ${scoreColor(b.evaluation.score)}22; color: ${scoreColor(b.evaluation.score)}">${b.evaluation.score}/100</span>` : ""}
      </div>
      <table class="phase-table">
        <thead>
          <tr><th>Phase</th><th>Time</th><th>Cost</th><th>Tokens</th><th>Turns</th></tr>
        </thead>
        <tbody>
          ${phaseRows([
            { label: "Plan", run: b.planRun },
            { label: "Review", run: b.reviewRun },
            { label: "Implement", run: b.implementRun },
          ])}
          ${b.evaluation ? `
          <tr style="color: var(--text-muted)">
            <td>Eval</td>
            <td>${formatDuration(b.evaluation.claudeResult.durationMs)}</td>
            <td>${formatCost(b.evaluation.claudeResult.costUsd)}</td>
            <td></td><td></td>
          </tr>` : ""}
        </tbody>
      </table>
    </div>

    <div class="arm-section" style="border-color: rgba(124, 58, 237, 0.3);">
      <div class="arm-header" style="border-bottom-color: rgba(124, 58, 237, 0.2);">
        <span class="arm-name">Context-Enhanced</span>
        ${c.evaluation ? `<span class="arm-score" style="background: ${scoreColor(c.evaluation.score)}22; color: ${scoreColor(c.evaluation.score)}">${c.evaluation.score}/100</span>` : ""}
      </div>
      <table class="phase-table">
        <thead>
          <tr><th>Phase</th><th>Time</th><th>Cost</th><th>Tokens</th><th>Turns</th></tr>
        </thead>
        <tbody>
          ${phaseRows([
            { label: "Initial Context", run: c.initialContextRun, isContext: true },
            { label: "Pattern Extraction", run: c.patternExtractionRun, isContext: true },
            { label: "Plan", run: c.planRun },
            { label: "Plan Context", run: c.planContextRun, isContext: true },
            { label: "Review", run: c.reviewRun },
            { label: "Implement", run: c.implementRun },
          ])}
          ${c.evaluation ? `
          <tr style="color: var(--text-muted)">
            <td>Eval</td>
            <td>${formatDuration(c.evaluation.claudeResult.durationMs)}</td>
            <td>${formatCost(c.evaluation.claudeResult.costUsd)}</td>
            <td></td><td></td>
          </tr>` : ""}
        </tbody>
      </table>
    </div>
  </div>

  ${hasEval ? `
  <!-- Eval Reasoning -->
  <div class="section">
    <div class="section-title">Evaluator Reasoning</div>
    <div class="reasoning-box">
      <div class="reasoning-label">Baseline (${b.evaluation!.score}/100)</div>
      <div class="reasoning-text">${escapeHtml(b.evaluation!.reasoning ?? "")}</div>
    </div>
    <div class="reasoning-box">
      <div class="reasoning-label">Context-Enhanced (${c.evaluation!.score}/100)</div>
      <div class="reasoning-text">${escapeHtml(c.evaluation!.reasoning ?? "")}</div>
    </div>
  </div>
  ` : ""}

  <!-- Code Changes: Baseline -->
  <div class="section">
    <div class="section-title">Code Changes &mdash; Baseline</div>
    <div class="diff-summary">
      <span>${b.diffStats.filesChanged} files</span>
      <span class="diff-added">+${b.diffStats.linesAdded}</span>
      <span class="diff-removed">-${b.diffStats.linesRemoved}</span>
    </div>
    <div class="diff-block"><pre><code>${formatDiff(b.diff)}</code></pre></div>
  </div>

  <!-- Code Changes: Context-Enhanced -->
  <div class="section">
    <div class="section-title">Code Changes &mdash; Context-Enhanced</div>
    <div class="diff-summary">
      <span>${c.diffStats.filesChanged} files</span>
      <span class="diff-added">+${c.diffStats.linesAdded}</span>
      <span class="diff-removed">-${c.diffStats.linesRemoved}</span>
    </div>
    <div class="diff-block"><pre><code>${formatDiff(c.diff)}</code></pre></div>
  </div>

  <!-- Footer -->
  <div class="footer">
    Generated by Context Engine Simulator &mdash;
    <a href="https://getunblocked.com">Unblocked</a>
  </div>

</div>
</body>
</html>`;

  const htmlPath = path.join(experimentDir, "report.html");
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

function formatDiff(diff: string): string {
  if (!diff || diff === "(no file changes detected)" || diff === "(failed to capture diff)") {
    return `<span style="color: var(--text-muted)">${escapeHtml(diff)}</span>`;
  }
  return diff.split("\n").map(line => {
    const escaped = escapeHtml(line);
    if (line.startsWith("+++") || line.startsWith("---")) return `<span class="diff-meta">${escaped}</span>`;
    if (line.startsWith("@@")) return `<span class="diff-hunk">${escaped}</span>`;
    if (line.startsWith("diff ")) return `<span class="diff-file">${escaped}</span>`;
    if (line.startsWith("+")) return `<span class="diff-add">${escaped}</span>`;
    if (line.startsWith("-")) return `<span class="diff-del">${escaped}</span>`;
    return escaped;
  }).join("\n");
}

function escapeHtml(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

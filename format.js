/**
 * format.js — AI Agent News digest → CONK Cast
 */

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function trim(s, n = 110) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function formatCast(data) {
  const date    = fmtDate(data.fetchedAt);
  const topHn   = data.hn?.[0];
  const topRepo = data.trendingRepos?.[0];

  // ── Hook (free preview) ─────────────────────────────────────────────────────
  const hook = topHn
    ? `AI Agent Digest — ${date} | Top story: ${trim(topHn.title, 70)} (${topHn.points}pts, ${topHn.comments} cmts)`
    : `AI Agent Digest — ${date} | Sources: HN, /r/LocalLLaMA, /r/MachineLearning, GitHub trending`;

  // ── Body (full report) ──────────────────────────────────────────────────────
  const hnBlock = (data.hn || []).slice(0, 8).map((s, i) =>
    `  ${i + 1}. ${trim(s.title, 100)}\n     ${s.points}pts · ${s.comments} cmts · ${s.domain}\n     ${s.url}`
  ).join('\n\n') || '  N/A';

  const llamaBlock = (data.reddit.localLlama || []).slice(0, 5).map((p, i) =>
    `  ${i + 1}. ${trim(p.title, 100)}\n     ${p.score}↑ · ${p.comments} cmts${p.flair ? ` · [${p.flair}]` : ''}\n     ${p.url}`
  ).join('\n\n') || '  N/A';

  const mlBlock = (data.reddit.machineLearning || []).slice(0, 5).map((p, i) =>
    `  ${i + 1}. ${trim(p.title, 100)}\n     ${p.score}↑ · ${p.comments} cmts${p.flair ? ` · [${p.flair}]` : ''}\n     ${p.url}`
  ).join('\n\n') || '  N/A';

  const reposBlock = (data.trendingRepos || []).slice(0, 5).map((r, i) =>
    `  ${i + 1}. ${r.name} (${r.language || 'mixed'}) — ${r.stars}★\n     ${trim(r.description, 110)}\n     ${r.url}`
  ).join('\n\n') || '  N/A';

  const body = `AI AGENT NEWS — DAILY DIGEST
Date: ${date}
Published on CONK | Persisted on Walrus

━━━━━━━━━━━━━━━━━━━━━━━━━━━
HACKER NEWS — TOP AI/AGENT STORIES (24H)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${hnBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
/r/LocalLLaMA — TOP OF DAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${llamaBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
/r/MachineLearning — TOP OF DAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${mlBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRENDING AGENT REPOS (LAST 7 DAYS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${reposBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA SOURCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━
HackerNews Algolia API, Reddit JSON, GitHub Search API
Fetched: ${data.fetchedAt}
Published by: AI News Daemon v1
Part of the CONK Intelligence Network — conk.app
`.trim();

  return { hook, body };
}

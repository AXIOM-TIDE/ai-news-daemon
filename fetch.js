/**
 * fetch.js — AI Agent News Digest
 *
 * Sources (no auth required):
 *   - HackerNews Algolia API — top "ai agent" / "llm" stories last 24h
 *   - Reddit JSON  — /r/LocalLLaMA, /r/MachineLearning top of day
 *   - GitHub API   — trending agent repos (no token, rate-limited)
 *
 * All graceful: any single source can fail without breaking the digest.
 */

const UA = { 'User-Agent': 'conk-ai-news-daemon/1.0 (+https://conk.app)' };

async function safely(label, fn, fallback = null) {
  try { return await fn(); }
  catch (e) { console.warn(`[fetch] ${label} failed: ${e.message}`); return fallback; }
}

// ─── HackerNews Algolia — last 24h, AI/agent stories ──────────────────────────

async function getHnTop(limit = 8) {
  return safely('hn', async () => {
    const since = Math.floor(Date.now() / 1000) - 86400;
    // Algolia treats query terms as AND by default; pull a wide net then filter.
    const url   = `https://hn.algolia.com/api/v1/search?query=ai&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=30`;
    const r     = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const d     = await r.json();
    const keep  = /(\bagent\b|\bagents\b|\bllm\b|\bmcp\b|\bclaude\b|\bgpt[- ]?\d|\bopenai\b|\banthropic\b|\bmodel\b|\binference\b|\bautonomous\b)/i;
    return (d.hits || [])
      .filter(h => h.title && keep.test(h.title))
      .slice(0, limit)
      .map(h => ({
        title:    h.title,
        url:      h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        points:   h.points,
        comments: h.num_comments,
        author:   h.author,
        domain:   h.url ? new URL(h.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com',
      }));
  }, []);
}

// ─── Reddit — /r/LocalLLaMA + /r/MachineLearning top of day ───────────────────

async function getReddit(sub, limit = 5) {
  return safely(`reddit/${sub}`, async () => {
    const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`;
    const r   = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
    const d   = await r.json();
    return (d?.data?.children || []).map(c => ({
      title:    c.data.title,
      url:      `https://www.reddit.com${c.data.permalink}`,
      score:    c.data.score,
      comments: c.data.num_comments,
      flair:    c.data.link_flair_text || null,
    }));
  }, []);
}

// ─── GitHub — trending agent repos (created in last 7 days, most starred) ─────

async function getTrendingRepos(limit = 5) {
  return safely('github-trending', async () => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    // GitHub search doesn't support OR across topic: qualifiers. Use a single
    // topic that captures the space well + a date filter.
    const q     = encodeURIComponent(`topic:agent stars:>5 pushed:>${since}`);
    const url   = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`;
    const r     = await fetch(url, { headers: { ...UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
    const d     = await r.json();
    return (d.items || []).map(repo => ({
      name:        repo.full_name,
      description: repo.description || '',
      stars:       repo.stargazers_count,
      url:         repo.html_url,
      language:    repo.language,
    }));
  }, []);
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

export async function fetchSuiStats() {  // kept name for index.js compat — exports the unified digest
  console.log('[fetch] Pulling AI agent news...');

  const [hn, llama, ml, repos] = await Promise.all([
    getHnTop(8),
    getReddit('LocalLLaMA', 5),
    getReddit('MachineLearning', 5),
    getTrendingRepos(5),
  ]);

  console.log(`[fetch] hn=${hn.length} llama=${llama.length} ml=${ml.length} repos=${repos.length}`);

  return {
    fetchedAt:   new Date().toISOString(),
    hn,
    reddit: {
      localLlama:      llama,
      machineLearning: ml,
    },
    trendingRepos: repos,
  };
}

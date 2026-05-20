/**
 * sui-stats-daemon — CONK Intelligence Daemon
 *
 * Publishes daily Sui ecosystem stats as Casts on CONK.
 * Access is open. Price: $0.001 USDC per read.
 * The Lighthouse surfaces the most-accessed Casts.
 *
 * This is a template. Fork it, swap fetch.js + format.js,
 * point it at your data source. Same daemon. Different intelligence.
 *
 * Required env:
 *   DAEMON_PRIVATE_KEY   — Sui private key (bech32 or hex)
 *   DAEMON_VESSEL_ID     — on-chain Vessel object ID
 *
 * Optional:
 *   PUBLISH_INTERVAL_MS  — milliseconds between publishes (default: 86400000 = 24h)
 *   SUI_RPC_URL          — Sui RPC endpoint
 *   CONK_PRICE_UNITS     — read price in USDC base units (default: 1000 = $0.001)
 *   DAEMON_NAME          — label for logs (default: sui-stats-daemon)
 */

import { fetchSuiStats }  from './fetch.js';
import { formatCast }     from './format.js';
import { soundCast }      from './conk.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const DAEMON_NAME    = process.env.DAEMON_NAME          || 'sui-stats-daemon';
const PRIVATE_KEY    = process.env.DAEMON_PRIVATE_KEY;
const VESSEL_ID      = process.env.DAEMON_VESSEL_ID;
const RPC_URL        = process.env.SUI_RPC_URL;
const PRICE_UNITS    = BigInt(process.env.CONK_PRICE_UNITS || '1000');   // $0.001
const INTERVAL_MS    = parseInt(process.env.PUBLISH_INTERVAL_MS || '86400000', 10); // 24h

function log(msg)  { console.log(`[${DAEMON_NAME}] ${new Date().toISOString()} ${msg}`); }
function err(msg)  { console.error(`[${DAEMON_NAME}] ERROR ${new Date().toISOString()} ${msg}`); }

// ─── Startup validation ───────────────────────────────────────────────────────

function validate() {
  const missing = [];
  if (!PRIVATE_KEY) missing.push('DAEMON_PRIVATE_KEY');
  if (!VESSEL_ID)   missing.push('DAEMON_VESSEL_ID');
  if (missing.length) {
    err(`Missing required env vars: ${missing.join(', ')}`);
    err('Run: node provision.js  to create a vessel, then set DAEMON_VESSEL_ID.');
    process.exit(1);
  }
}

// ─── Single publish cycle ─────────────────────────────────────────────────────

async function publish() {
  log('Starting publish cycle...');

  // 1. Fetch
  let stats;
  try {
    stats = await fetchSuiStats();
    log(`Data fetched. Txs: ${stats.network.totalTransactions?.toLocaleString()}, TVL: ${stats.defi.tvlUsd}`);
  } catch (e) {
    err(`Fetch failed: ${e.message}`);
    return;
  }

  // 2. Format
  const { hook, body } = formatCast(stats);
  log(`Hook: "${hook.slice(0, 80)}..."`);

  // 3. Publish to CONK
  try {
    const result = await soundCast({
      hook,
      body,
      price:      PRICE_UNITS,
      vesselId:   VESSEL_ID,
      privateKey: PRIVATE_KEY,
      rpcUrl:     RPC_URL,
    });

    log(`✅ Cast published!`);
    log(`   Cast ID  : ${result.castId}`);
    log(`   Tx       : ${result.txDigest}`);
    log(`   URL      : ${result.url}`);
    log(`   Wallet   : ${result.address}`);
  } catch (e) {
    err(`Publish failed: ${e.message}`);
    if (e.message.includes('no USDC')) {
      err(`Fund the daemon wallet with USDC on Sui mainnet and restart.`);
    }
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  validate();

  log(`Starting. Vessel: ${VESSEL_ID}`);
  log(`Publish interval: ${(INTERVAL_MS / 3_600_000).toFixed(1)}h`);
  log(`Read price: ${PRICE_UNITS} base units = $${(Number(PRICE_UNITS) / 1_000_000).toFixed(4)} USDC`);

  // Publish immediately on boot, then on interval
  await publish();

  setInterval(async () => {
    await publish();
  }, INTERVAL_MS);
}

main().catch(e => {
  err(`Fatal: ${e.message}`);
  process.exit(1);
});

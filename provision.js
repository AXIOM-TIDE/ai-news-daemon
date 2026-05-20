/**
 * provision.js — One-time setup: open Harbor + launch Vessel for this daemon.
 *
 * Mirrors the production Bridge flow in CONK/apps/conk/src/sui/client.ts
 * against the live v9 package (Stream, 2026-05-13).
 *
 * Required env:
 *   DAEMON_PRIVATE_KEY  — daemon's Sui private key (bech32 suiprivkey1... or 0x-hex)
 *
 * Outputs:
 *   DAEMON_HARBOR_ID     (shared Harbor object)
 *   DAEMON_HARBOR_CAP_ID (owned HarborCap)
 *   DAEMON_VESSEL_ID     (owned Vessel object)
 *   DAEMON_VESSEL_CAP_ID (owned VesselCap)
 *
 * Wallet requirements:
 *   >= 0.01 SUI  (gas, two txs)
 *   >= 0.15 USDC (tier-1 Harbor open: 0.05 tier cost + 0.10 minimum balance)
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction }    from '@mysten/sui/transactions';
import { SuiClient }      from '@mysten/sui/client';

const CONK_PACKAGE = '0x50515260e8f766ad01461f78065b18510fef6879c3a8a776edc7da76a1db62a8'; // v9 Stream
const USDC_TYPE    = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const CLOCK_OBJ    = '0x0000000000000000000000000000000000000000000000000000000000000006';
const RPC_URL      = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

const HARBOR_TIER   = 1;        // tier-1: 1 vessel limit, $0.05 cost
const HARBOR_FUND   = 150_000n; // $0.15 USDC = tier cost + minimum balance
const VESSEL_TIER   = 0;        // 0 = GHOST
const BURN_AFTER    = false;

const rawKey = process.env.DAEMON_PRIVATE_KEY;
if (!rawKey) {
  console.error('❌ DAEMON_PRIVATE_KEY not set.');
  process.exit(1);
}

const client = new SuiClient({ url: RPC_URL });

const kp = rawKey.startsWith('suiprivkey')
  ? Ed25519Keypair.fromSecretKey(rawKey)
  : Ed25519Keypair.fromSecretKey(Buffer.from(rawKey.replace('0x', ''), 'hex'));

const address = kp.getPublicKey().toSuiAddress();
console.log(`\nDaemon wallet: ${address}`);

// ── Balance + idempotency check ────────────────────────────────────────────────
const [suiBal, usdcBal] = await Promise.all([
  client.getBalance({ owner: address }),
  client.getBalance({ owner: address, coinType: USDC_TYPE }),
]);
const sui  = Number(suiBal.totalBalance) / 1e9;
const usdc = Number(usdcBal.totalBalance) / 1e6;
console.log(`SUI balance  : ${sui.toFixed(6)} SUI`);
console.log(`USDC balance : $${usdc.toFixed(6)}\n`);

if (sui < 0.01)  { console.error('❌ Need ≥0.01 SUI for gas.');  process.exit(1); }
if (usdc < 0.15) { console.error('❌ Need ≥0.15 USDC for Harbor open.'); process.exit(1); }

const existingHC = await client.getOwnedObjects({
  owner:   address,
  filter:  { StructType: `${CONK_PACKAGE}::harbor::HarborCap` },
  options: { showContent: true, showType: true },
});
if (existingHC.data.length > 0) {
  console.error('❌ Daemon already owns a HarborCap. Refusing to double-provision.');
  console.error('   HarborCap:', existingHC.data[0].data?.objectId);
  process.exit(1);
}

// ── 1. Open Harbor ─────────────────────────────────────────────────────────────
console.log('Opening Harbor (tier 1, $0.15 USDC)…');

const usdcCoins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
if (usdcCoins.data.length === 0) { console.error('❌ No USDC coin objects.'); process.exit(1); }
const usdcCoinId = usdcCoins.data[0].coinObjectId;

const tx1 = new Transaction();
const [payment] = tx1.splitCoins(tx1.object(usdcCoinId), [tx1.pure.u64(HARBOR_FUND)]);
const harborCap = tx1.moveCall({
  target:    `${CONK_PACKAGE}::harbor::open`,
  arguments: [payment, tx1.pure.u8(HARBOR_TIER), tx1.object(CLOCK_OBJ)],
});
tx1.transferObjects([harborCap], tx1.pure.address(address));
tx1.setSender(address);

const built1 = await tx1.build({ client });
const sig1   = await kp.signTransaction(built1);
const res1   = await client.executeTransactionBlock({
  transactionBlock: built1,
  signature:        sig1.signature,
  options:          { showEffects: true, showObjectChanges: true },
});

if (res1.effects?.status?.status !== 'success') {
  console.error('❌ Harbor open failed:', res1.effects?.status?.error);
  console.error('   digest:', res1.digest);
  process.exit(1);
}

// Same trap on Harbor/HarborCap.
const harborObj    = res1.objectChanges?.find(c => c.type === 'created' && /::harbor::Harbor($|<)/.test(c.objectType || ''));
const harborCapObj = res1.objectChanges?.find(c => c.type === 'created' && /::harbor::HarborCap($|<)/.test(c.objectType || ''));
if (!harborObj || !harborCapObj) {
  console.error('❌ Harbor objects not in tx output. Changes:', JSON.stringify(res1.objectChanges, null, 2));
  process.exit(1);
}
const harborId    = harborObj.objectId;
const harborCapId = harborCapObj.objectId;
console.log(`   Harbor    : ${harborId}`);
console.log(`   HarborCap : ${harborCapId}`);
console.log(`   tx        : ${res1.digest}\n`);

// ── 2. Launch Vessel ───────────────────────────────────────────────────────────
console.log('Launching Vessel (tier 0 GHOST, burn_after_cast=false)…');

const tx2 = new Transaction();
const vesselCap = tx2.moveCall({
  target:    `${CONK_PACKAGE}::vessel::launch`,
  arguments: [
    tx2.object(harborId),
    tx2.pure.u8(VESSEL_TIER),
    tx2.pure.bool(BURN_AFTER),
    tx2.object(CLOCK_OBJ),
  ],
});
tx2.transferObjects([vesselCap], tx2.pure.address(address));
tx2.setSender(address);

const built2 = await tx2.build({ client });
const sig2   = await kp.signTransaction(built2);
const res2   = await client.executeTransactionBlock({
  transactionBlock: built2,
  signature:        sig2.signature,
  options:          { showEffects: true, showObjectChanges: true },
});

if (res2.effects?.status?.status !== 'success') {
  console.error('❌ Vessel launch failed:', res2.effects?.status?.error);
  console.error('   digest:', res2.digest);
  process.exit(1);
}

// Tight match: VesselCap also matches '::vessel::Vessel' substring, so use exact type endings.
const vesselObj    = res2.objectChanges?.find(c => c.type === 'created' && /::vessel::Vessel($|<)/.test(c.objectType || ''));
const vesselCapObj = res2.objectChanges?.find(c => c.type === 'created' && /::vessel::VesselCap($|<)/.test(c.objectType || ''));
if (!vesselObj || !vesselCapObj) {
  console.error('❌ Vessel objects not in tx output. Changes:', JSON.stringify(res2.objectChanges, null, 2));
  process.exit(1);
}
const vesselId    = vesselObj.objectId;
const vesselCapId = vesselCapObj.objectId;

console.log(`   Vessel    : ${vesselId}`);
console.log(`   VesselCap : ${vesselCapId}`);
console.log(`   tx        : ${res2.digest}\n`);

console.log('✅ Provisioned.');
console.log('Add to Railway env:');
console.log(`   DAEMON_PRIVATE_KEY=<keep secret>`);
console.log(`   DAEMON_HARBOR_ID=${harborId}`);
console.log(`   DAEMON_HARBOR_CAP_ID=${harborCapId}`);
console.log(`   DAEMON_VESSEL_ID=${vesselId}`);
console.log(`   DAEMON_VESSEL_CAP_ID=${vesselCapId}`);

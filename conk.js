/**
 * conk.js — CONK Cast publisher
 *
 * Standalone module for publishing Casts to CONK on Sui mainnet.
 * No SDK dependency — direct PTB construction matching the live contract.
 *
 * Required env vars:
 *   DAEMON_PRIVATE_KEY   — bech32 (suiprivkey1q...) or hex private key
 *   DAEMON_VESSEL_ID     — on-chain Vessel object ID for this daemon
 *
 * Optional:
 *   SUI_RPC_URL          — defaults to mainnet public RPC
 *   CONK_PRICE_UNITS     — read price in USDC base units (default: 1000 = $0.001)
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction }    from '@mysten/sui/transactions';
import { SuiClient }      from '@mysten/sui/client';

// ─── Contract constants (v9, live) ────────────────────────────────────────────

const CONK_PACKAGE  = '0x7bc8f81b03cede714045a9f24e5f776fc449000c9414e33908ebe177d3b5ac2b';
const ABYSS_OBJ     = '0x392d5f46b5f02fb34cc0cb06c27e89b6e4dacc4cafd41e3b9ac1bc9f02dd1598';
const CLOCK_OBJ     = '0x0000000000000000000000000000000000000000000000000000000000000006';
const USDC_TYPE     = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SOUND_FEE     = 1000n;  // $0.001 publish fee passed to abyss::receive_cast

// ─── cast::sound() mode + duration constants (cast.move) ──────────────────────
const MODE_OPEN       = 0;
const MODE_SEALED     = 1;
const MODE_EYES_ONLY  = 2;
const MODE_GHOST      = 3;
const DUR_24H         = 1;
const DUR_48H         = 2;
const DUR_72H         = 3;
const DUR_7D          = 4;
const VESSEL_TIER_GHOST  = 0;

const enc = new TextEncoder();

// ─── Sui client ───────────────────────────────────────────────────────────────

export function makeClient(rpcUrl) {
  return new SuiClient({ url: rpcUrl || 'https://fullnode.mainnet.sui.io:443' });
}

// ─── Key/signer ───────────────────────────────────────────────────────────────

export function buildSigner(privateKey, suiClient) {
  const kp = privateKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(privateKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.replace('0x', ''), 'hex'));

  const address = kp.getPublicKey().toSuiAddress();

  const sign = async (tx) => {
    tx.setSender(address);
    const bytes  = await tx.build({ client: suiClient });
    const signed = await kp.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: bytes,
      signature:        signed.signature,
      options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Sui tx failed: ${result.effects?.status?.error} (${result.digest})`);
    }
    return { digest: result.digest, changes: result.objectChanges || [] };
  };

  return { address, sign };
}

// ─── Publish a Cast ───────────────────────────────────────────────────────────

/**
 * soundCast — publish content as a paid Cast on CONK
 *
 * @param {object} opts
 * @param {string} opts.hook        — headline / title (shown in previews)
 * @param {string} opts.body        — full content (paid readers see this)
 * @param {bigint} [opts.price]     — read price in USDC base units (default: SOUND_FEE)
 * @param {string} opts.vesselId    — author's Vessel object ID
 * @param {string} opts.privateKey  — signer private key
 * @param {string} [opts.rpcUrl]    — Sui RPC URL
 * @returns {{ castId, txDigest, url }}
 */
export async function soundCast({ hook, body, price, vesselId, privateKey, rpcUrl }) {
  const client            = makeClient(rpcUrl);
  const { address, sign } = buildSigner(privateKey, client);
  const readPrice         = price ?? SOUND_FEE;

  // Fetch a USDC coin to cover the sound fee
  const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
  if (!coins.data.length) {
    throw new Error(`Daemon wallet ${address} has no USDC. Fund it before publishing.`);
  }
  const usdcCoinId = coins.data[0].coinObjectId;

  // Build transaction — matches v9 cast::sound() signature exactly:
  //   fee_coin, &mut abyss, vessel_id ID, vessel_tier u8,
  //   hook vec<u8>, content_blob vec<u8>, media_blob Option<vec<u8>>,
  //   mode u8, recipient address, duration u8, fee u64,
  //   max_claims u64, dock_description vec<u8>, &Clock, &mut TxContext
  const tx = new Transaction();
  const [paymentCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(SOUND_FEE)]);

  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::sound`,
    arguments: [
      paymentCoin,                                                       // fee_coin
      tx.object(ABYSS_OBJ),                                              // &mut abyss
      tx.pure.id(vesselId),                                              // vessel_id
      tx.pure.u8(VESSEL_TIER_GHOST),                                     // vessel_tier (0 = GHOST)
      tx.pure.vector('u8', Array.from(enc.encode(hook))),                // hook
      tx.pure.vector('u8', Array.from(enc.encode(body))),                // content_blob
      tx.pure.option('vector<u8>', null),                                // media_blob = None
      tx.pure.u8(MODE_OPEN),                                             // mode = OPEN (0)
      tx.pure.address(address),                                          // recipient = author
      tx.pure.u8(DUR_24H),                                               // duration = 24h
      tx.pure.u64(readPrice),                                            // fee (read price)
      tx.pure.u64(1n),                                                   // max_claims = 1 (no Dock upgrade fee)
      tx.pure.vector('u8', []),                                          // dock_description = empty
      tx.object(CLOCK_OBJ),                                              // &Clock
    ],
  });

  const { digest, changes } = await sign(tx);

  const castObj = changes.find(
    c => c.type === 'created' && c.objectType?.includes('::cast::Cast'),
  );
  const castId = castObj?.objectId ?? 'UNKNOWN';
  const url    = `https://conk.app/cast/${castId}`;

  return { castId, txDigest: digest, url, address };
}

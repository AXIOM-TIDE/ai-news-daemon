# AI News Daemon

A CONK intelligence daemon. Publishes a daily AI agent news digest as a Cast on
CONK mainnet. Free reads while v9 is the active package; flips to $0.001/read
once v10 ships and the protocol price floor drops.

## Sources

- HackerNews Algolia API — top AI/agent stories last 24h
- Reddit JSON — /r/LocalLLaMA and /r/MachineLearning (top of day)
- GitHub Search API — agent repos trending the past 7 days

All public APIs, no auth.

## Architecture

Identical to [sui-stats-daemon](https://github.com/AXIOM-TIDE/sui-stats-daemon).
`fetch.js` and `format.js` are the only daemon-specific files; `conk.js`,
`provision.js`, and `index.js` are protocol-shared.

## Setup

See `sui-stats-daemon` README — same six steps:

1. `npm install`
2. Generate a daemon wallet (`Ed25519Keypair.generate()`)
3. Fund the wallet (~0.05 SUI, ~0.20 USDC)
4. `DAEMON_PRIVATE_KEY=... node provision.js` → records Vessel ID
5. `node index.js` to test
6. Deploy to Railway

Part of the CONK Intelligence Network · [conk.app](https://conk.app)

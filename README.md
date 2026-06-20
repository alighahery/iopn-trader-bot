# IOPn Testnet Trader Bot 🤖

A Telegram trading bot for the **IOPn Testnet** blockchain, built on Cloudflare Workers + Vercel.

## Architecture

```
Telegram User
      │
      ▼
Cloudflare Worker          Vercel API (Next.js)
  - Webhook handler    →   - /api/create-opn-wallet
  - Command routing        - /api/send-opn
  - KV wallet storage      - /api/send-erc20
  - Balance queries        - /api/swap-opn
                           - /api/multisend
                           - /api/add-liquidity
                           - /api/remove-liquidity
                                │
                                ▼
                         IOPn Testnet RPC
                         (ethers.js signing)
```

**Why this split?**
- Cloudflare Workers runs a V8 isolate — no Node.js, no native crypto libs
- Vercel runs full Node.js — ethers.js signs transactions natively
- Worker handles all Telegram logic; Vercel handles all blockchain signing

## Features

| Command | Description |
|---------|-------------|
| `/wallet` | Create or view your wallet + balances |
| `/privatekey` | Show private key |
| `/my_balance` | Check OPN balance |
| `/balance <address>` | Check any address balance |
| `/profile` | Full dashboard |
| `/send <to> <amount>` | Send native OPN |
| `/swap <from> <to> <amount>` | Swap tokens via IOPn DEX |
| `/multisend` | Batch send to multiple addresses |
| `/network` | Network info for MetaMask |
| `/faucet` | Link to testnet faucet |
| `/addliquidity <A> <B> <amtA> <amtB>` | Add liquidity (symbol or 0x address) |
| `/removeliquidity <A> <B> <percent>` | Remove `percent`% of your LP |
| `/mytokens` | Show **every** token in the wallet (built-in + created + any pool token) with balance > 0 |
| `/mypools` | Your LP positions with pool share and underlying amounts |

## Supported Tokens

| Symbol | Contract |
|--------|----------|
| OPN | Native |
| WOPN | `0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84` |
| OPNT | `0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d` |
| tBNB | `0x92cF36713a5622351c9489D5556B90B321873607` |
| tUSDT | `0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b` |
| IRR | `0xf250aB45BDE152fDe5c1F009f621069730d3D574` |

## Contract Addresses

| Contract | Address |
|----------|---------|
| Router (DEX) | `0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885` |
| Factory | `0x8860242B65611dfd077aEe26C3C7920813dF9208` |
| WOPN | `0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84` |

## Network

| Parameter | Value |
|-----------|-------|
| Chain ID | `984` |
| RPC | `https://testnet-rpc.iopn.tech` |
| Explorer | `https://testnet.iopn.tech` |

## Deployment

### 1. Vercel API

```bash
cd api
npm install
vercel --prod
```

No environment variables required for the API.

### 2. Cloudflare Worker

1. Create a **KV Namespace** named `WALLETS`
2. Deploy `worker/worker.js`
3. Set these **Environment Variables**:

| Variable | Value |
|----------|-------|
| `BOT_TOKEN` | Your Telegram bot token |
| `ADMIN_SECRET` | Any secret string |
| `VERCEL_WALLET_URL` | `https://YOUR-DOMAIN.vercel.app/api/create-opn-wallet` |
| `VERCEL_SEND_URL` | `https://YOUR-DOMAIN.vercel.app/api/send-opn` |
| `VERCEL_SEND_ERC20_URL` | `https://YOUR-DOMAIN.vercel.app/api/send-erc20` |
| `VERCEL_SWAP_URL` | `https://YOUR-DOMAIN.vercel.app/api/swap-opn` |
| `VERCEL_MULTISEND_URL` | `https://YOUR-DOMAIN.vercel.app/api/multisend` |
| `VERCEL_ADD_LIQUIDITY_URL` | `https://YOUR-DOMAIN.vercel.app/api/add-liquidity` |
| `VERCEL_REMOVE_LIQUIDITY_URL` | `https://YOUR-DOMAIN.vercel.app/api/remove-liquidity` |


4. Register webhook:
```
https://YOUR-WORKER.workers.dev/register?secret=YOUR_ADMIN_SECRET
```

## MultiSend Format

**Fixed amounts:**
```
/multisend
0xAddress1 1.5
0xAddress2 2.0
0xAddress3 0.5
```

**Random amounts:**
```
/multisend random 1 5
0xAddress1
0xAddress2
0xAddress3
```
## How token discovery works (no full log scan)
The IOPn testnet RPC caps `eth_getLogs` at a 10,000-block range, so a full
history scan isn't practical in a Worker. `/mytokens` instead unions:
1. Built-in `TOKEN_LIST`
2. Tokens the user created via `/deploytoken` (saved in KV on deploy)
3. Every token that appears in a DEX factory pool (batched `allPairs` →
   `token0`/`token1`)
   
## Tech Stack

- **Cloudflare Workers** — Serverless edge runtime
- **Vercel (Next.js App Router)** — Node.js API for transaction signing
- **ethers.js v6** — Ethereum library
- **Telegram Bot API** — Messaging interface
- **Cloudflare KV** — Wallet storage

## License

MIT

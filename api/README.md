# IOPn API — Vercel

Next.js API for signing IOPn testnet transactions.

## Endpoints

### `POST /api/create-opn-wallet`
Creates a new wallet. Returns `{ address, privateKey }`.

### `POST /api/send-opn`
Send native OPN.
```json
{ "to": "0x...", "amount": "1.5", "privateKey": "0x..." }
```

### `POST /api/send-erc20`
Send any ERC20 token.
```json
{ "to": "0x...", "amount": "10", "tokenAddress": "0x...", "privateKey": "0x..." }
```

### `POST /api/swap-opn`
Swap tokens via IOPn DEX Router.
```json
{ "tokenIn": "OPN", "tokenOut": "TUSDT", "amount": "0.1", "privateKey": "0x..." }
```
Supported: `OPN`, `WOPN`, `OPNT`, `TBNB`, `TUSDT`, `IRR`

### `POST /api/multisend`
Send to multiple addresses.
```json
{
  "privateKey": "0x...",
  "recipients": [
    { "to": "0xAddr1", "amount": "1.5" },
    { "to": "0xAddr2", "amount": "2.0" }
  ],
  "tokenAddress": null
}
```
`tokenAddress: null` → native OPN, otherwise ERC20 address.

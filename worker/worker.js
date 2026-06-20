// ============================================================
//  IOPn Testnet Trader Bot — Cloudflare Worker
//
//  Architecture: Cloudflare Worker + Vercel API
//  - Worker: Telegram handling, wallet storage in KV
//  - Vercel API: transaction signing with ethers.js
//
//  Cloudflare Environment Variables:
//    BOT_TOKEN          — Telegram bot token
//    ADMIN_SECRET       — webhook registration secret
//    WALLETS            — KV Namespace binding
//    VERCEL_WALLET_URL  — https://YOUR-DOMAIN.vercel.app/api/create-opn-wallet
//    VERCEL_SEND_URL    — https://YOUR-DOMAIN.vercel.app/api/send-opn
//    VERCEL_SEND_ERC20_URL — https://YOUR-DOMAIN.vercel.app/api/send-erc20
//    VERCEL_SWAP_URL    — https://YOUR-DOMAIN.vercel.app/api/swap-opn
//    VERCEL_MULTISEND_URL  — https://YOUR-DOMAIN.vercel.app/api/multisend
//    VERCEL_DEPLOY_TOKEN_URL — https://YOUR-DOMAIN.vercel.app/api/deploy-token
//    VERCEL_ADD_LIQUIDITY_URL    — https://YOUR-DOMAIN.vercel.app/api/add-liquidity
//    VERCEL_REMOVE_LIQUIDITY_URL — https://YOUR-DOMAIN.vercel.app/api/remove-liquidity
// ============================================================

const RPC_URL  = "https://testnet-rpc.iopn.tech";
const EXPLORER = "https://testnet.iopn.tech";
const CHAIN_ID = 984;

// DEX contracts on IOPn testnet (same addresses the DEX frontend uses)
const ROUTER_ADDRESS  = "0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885";
const FACTORY_ADDRESS = "0x8860242B65611dfd077aEe26C3C7920813dF9208";
const WOPN_ADDRESS    = "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84";

const TOKEN_LIST = {
  OPN:   { symbol: "OPN",   address: null,                                        decimals: 18 },
  OPNT:  { symbol: "OPNT",  address: "0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d", decimals: 18 },
  TBNB:  { symbol: "tBNB",  address: "0x92cF36713a5622351c9489D5556B90B321873607", decimals: 18 },
  TUSDT: { symbol: "tUSDT", address: "0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b", decimals: 18 },
  WOPN:  { symbol: "WOPN",  address: "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84", decimals: 18 },
  IRR:   { symbol: "IRR",   address: "0xf250aB45BDE152fDe5c1F009f621069730d3D574", decimals: 18 },
};

// ─── Main Handler ──────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({ status: "OK", bot: "IOPn Worker Bot v3" });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return new Response("bad json", { status: 400 });
      // ctx.waitUntil keeps the Worker alive until the task completes
      ctx.waitUntil(handleUpdate(body, env));
      return new Response("ok");
    }

    if (url.pathname === "/register") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.ADMIN_SECRET) return new Response("forbidden", { status: 403 });
      const res = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `${url.origin}/webhook` }) }
      );
      return Response.json(await res.json());
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ─── Update Router ─────────────────────────────────────────────
async function handleUpdate(body, env) {
  const send = (chatId, text) => sendMessage(env, chatId, text);

  // Callback query handler
  if (body.callback_query) {
    const cq     = body.callback_query;
    const chatId = cq.message.chat.id;
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id }),
    });
    const d = cq.data;
    if (d === "wallet")    return send(chatId, "👛 Command: /wallet");
    if (d === "profile")   return handleProfile(env, chatId);
    if (d === "send")      return send(chatId, "💸 Format: `/send <address> <amount>`");
    if (d === "history")   return handleHistory(env, chatId);
    if (d === "network")   return handleNetwork(env, chatId);
    if (d === "faucet")    return handleFaucet(env, chatId);
    if (d === "swap")      return send(chatId, "🔄 Format: `/swap <from> <to> <amount>`\nExample: `/swap OPN TUSDT 0.1`\n\nSupported tokens: " + Object.keys(TOKEN_LIST).join(", "));
    if (d === "deploytoken")  return send(chatId, "🚀 Format: `/deploytoken <name> <symbol> <supply>`\nExample: `/deploytoken MyToken MTK 1000000`");
    if (d === "importwallet")  return send(chatId, "🔑 Format: `/importwallet <privatekey>`\n⚠️ Send this in private chat only!");
    if (d === "multisend") return send(chatId, "📤 Format:\n`/multisend\n0xAddr1 1.5\n0xAddr2 2.0`\nor random:\n`/multisend random 1 5\n0xAddr1\n0xAddr2`");
    if (d === "mytokens")  return handleMyTokens(env, chatId);
    if (d === "mypools")   return handleMyPools(env, chatId);
    if (d === "addliquidity")    return send(chatId, "➕ Format: `/addliquidity <tokenA> <tokenB> <amountA> <amountB>`\nExample: `/addliquidity OPN TUSDT 0.1 5`\n\nUse a token symbol or a 0x contract address.\nSupported symbols: " + Object.keys(TOKEN_LIST).join(", "));
    if (d === "removeliquidity") return send(chatId, "➖ Format: `/removeliquidity <tokenA> <tokenB> <percent>`\nExample: `/removeliquidity OPN TUSDT 100`\n(100 = remove 100% of your LP; you can also give an exact LP amount)");
    return;
  }

  if (!body.message?.text) return;
  const msg    = body.message.text.trim();
  const chatId = body.message.chat.id;

  if (msg === "/start" || msg === "/help") return handleStart(env, chatId);
  if (msg === "/wallet")                   return handleWallet(env, chatId);
  if (msg === "/privatekey")               return handlePrivateKey(env, chatId);
  if (msg === "/my_balance" || msg === "/mybalance") return handleMyBalance(env, chatId);
  if (msg.startsWith("/balance"))          return handleBalance(env, chatId, msg);
  if (msg === "/profile")                  return handleProfile(env, chatId);
  if (msg === "/network")                  return handleNetwork(env, chatId);
  if (msg === "/faucet")                   return handleFaucet(env, chatId);
  if (msg === "/history")                  return handleHistory(env, chatId);
  if (msg.startsWith("/send "))            return handleSend(env, chatId, msg);
  if (msg.startsWith("/swap "))            return handleSwap(env, chatId, msg);
  if (msg.startsWith("/multisend"))        return handleMultiSend(env, chatId, msg);
  if (msg.startsWith("/deploytoken"))       return handleDeployToken(env, chatId, msg);
  if (msg.startsWith("/importwallet"))      return handleImportWallet(env, chatId, msg);
  if (msg.startsWith("/addliquidity"))      return handleAddLiquidity(env, chatId, msg);
  if (msg.startsWith("/removeliquidity"))   return handleRemoveLiquidity(env, chatId, msg);
  if (msg === "/mytokens" || msg === "/tokens")                 return handleMyTokens(env, chatId);
  if (msg === "/mypools" || msg === "/pools" || msg === "/positions") return handleMyPools(env, chatId);

  await sendMessage(env, chatId, "❓ Unknown command. See /start for the list.");
}

// ─── Command Handlers ──────────────────────────────────────────

async function handleStart(env, chatId) {
  await sendWithKeyboard(env, chatId,
    "👋 *Welcome to IOPn Trader Bot* 🚀\n\n" +
    "📋 *Commands:*\n" +
    "• `/wallet` — Create or view wallet\n" +
    "• `/privatekey` — Show private key\n" +
    "• `/my_balance` — OPN balance\n" +
    "• `/balance <address>` — Any address balance\n" +
    "• `/profile` — Full dashboard\n" +
    "• `/send <to> <amount>` — Send OPN\n" +
    "• `/swap <from> <to> <amount>` — Swap tokens\n" +
    "• `/mytokens` — Show ALL tokens in your wallet\n" +
    "• `/addliquidity <A> <B> <amtA> <amtB>` — Add liquidity\n" +
    "• `/removeliquidity <A> <B> <percent>` — Remove liquidity\n" +
    "• `/mypools` — Your liquidity positions\n" +
    "• `/multisend` — Batch send\n" +
    "• `/network` — Network info\n" +
    "• `/faucet` — Get testnet OPN\n" +
    "• `/deploytoken <name> <symbol> <supply>` — Deploy ERC20 token\n" +
    "• `/importwallet <privatekey>` — Import existing wallet"
  );
}

async function handleWallet(env, chatId) {
  const userKey  = `user:${chatId}`;
  const existing = await env.WALLETS.get(userKey);

  if (!existing) {
    try {
      const res = await fetch(env.VERCEL_WALLET_URL, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "wallet error");
      await env.WALLETS.put(userKey, JSON.stringify(data));
      await sendMessage(env, chatId,
        "✅ *New wallet created!*\n\n" +
        "📬 Address:\n`" + data.address + "`\n\n" +
        "🔑 Private Key:\n`" + data.privateKey + "`\n\n" +
        "⚠️ *Save your private key now — shown only once!*\n\n" +
        `🔗 [Explorer](${EXPLORER}/address/${data.address})`
      );
    } catch (e) {
      await sendMessage(env, chatId, "❌ Wallet creation error: " + e.message);
    }
    return;
  }

  const w = JSON.parse(existing);
  await sendMessage(env, chatId, "⏳ Fetching balances...");

  const lines = [];
  for (const key of Object.keys(TOKEN_LIST)) {
    const t = TOKEN_LIST[key];
    try {
      const bal = await getTokenBalance(t.address, w.address, t.decimals);
      if (bal > 0) lines.push(`• ${t.symbol}: \`${bal.toFixed(6)}\``);
    } catch {}
  }

  await sendMessage(env, chatId,
    "👛 *Your Wallet:*\n\n`" + w.address + "`\n\n" +
    "💰 *Balances:*\n" +
    (lines.length ? lines.join("\n") : "No tokens found yet.") + "\n\n" +
    `🔗 [Explorer](${EXPLORER}/address/${w.address})`
  );
}

async function handlePrivateKey(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  await sendMessage(env, chatId,
    "🔑 *Private Key:*\n\n`" + w.privateKey + "`\n\n" +
    "⚠️ Never share this with anyone!\n" +
    "👛 Address: `" + w.address + "`"
  );
}

async function handleMyBalance(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  try {
    const bal = await getNativeBalance(w.address);
    await sendMessage(env, chatId,
      "💰 *Your Balance:*\n\n`" + w.address + "`\n" +
      `OPN: \`${bal.toFixed(6)}\`\n\n` +
      `🔗 [Explorer](${EXPLORER}/address/${w.address})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

async function handleBalance(env, chatId, msg) {
  const addr = msg.split(" ")[1]?.trim();
  if (!addr || !isAddress(addr)) return sendMessage(env, chatId, "❌ Format: `/balance <address>`");
  try {
    const bal = await getNativeBalance(addr);
    await sendMessage(env, chatId,
      `💰 Balance of \`${addr}\`:\n\nOPN: \`${bal.toFixed(6)}\`\n\n` +
      `🔗 [Explorer](${EXPLORER}/address/${addr})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

async function handleProfile(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  try {
    const bal = await getNativeBalance(w.address);
    await sendMessage(env, chatId,
      "👤 *Your Profile*\n\n" +
      `👛 Address: \`${w.address}\`\n` +
      `💰 Balance: ${bal.toFixed(6)} OPN\n\n` +
      `[📊 Explorer](${EXPLORER}/address/${w.address})\n` +
      `[📜 Transactions](${EXPLORER}/address/${w.address}#transactions)`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

async function handleNetwork(env, chatId) {
  await sendMessage(env, chatId,
    "🌐 *Add IOPn Testnet to MetaMask:*\n\n" +
    `*Network Name:* IOPn Testnet\n` +
    `*RPC URL:* \`${RPC_URL}\`\n` +
    `*Chain ID:* \`${CHAIN_ID}\`\n` +
    "*Currency:* `OPN`\n" +
    `*Explorer:* \`${EXPLORER}\``
  );
}

async function handleFaucet(env, chatId) {
  await sendMessage(env, chatId,
    "🪙 *IOPn Testnet Faucet:*\n\nhttps://faucet.iopn.tech\n\n" +
    "1. Open the link\n2. Get your wallet address from /wallet\n3. Request OPN"
  );
}

async function handleHistory(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  await sendMessage(env, chatId,
    "📜 *Transaction History:*\n\n" +
    `👛 \`${w.address}\`\n\n` +
    `[🔗 View on Explorer](${EXPLORER}/address/${w.address})`
  );
}

// ─── /send ──────────────────────────────────────────────────────
async function handleSend(env, chatId, msg) {
  const parts = msg.split(" ");
  if (parts.length < 3) return sendMessage(env, chatId, "❌ Format: `/send <address> <amount>`");
  const to     = parts[1].trim();
  const amount = parts[2].trim();
  if (!isAddress(to)) return sendMessage(env, chatId, "❌ Invalid address.");
  if (isNaN(Number(amount)) || Number(amount) <= 0) return sendMessage(env, chatId, "❌ Invalid amount.");

  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  await sendMessage(env, chatId,
    `⏳ Sending transaction...\nFrom: \`${w.address}\`\nTo: \`${to}\`\nAmount: \`${amount} OPN\``
  );

  try {
    const res  = await fetch(env.VERCEL_SEND_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, amount, privateKey: w.privateKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "send error");
    await sendMessage(env, chatId,
      "✅ *Transaction sent!*\n\n`" + data.txHash + "`\n\n" +
      `🔗 [Explorer](${EXPLORER}/tx/${data.txHash})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

// ─── /swap ──────────────────────────────────────────────────────
async function handleSwap(env, chatId, msg) {
  const parts = msg.split(" ");
  if (parts.length < 4) return sendMessage(env, chatId,
    "❌ Format: `/swap <from> <to> <amount>`\nExample: `/swap OPN TUSDT 0.1`\n\n" +
    "Supported tokens: " + Object.keys(TOKEN_LIST).join(", ")
  );

  const tokenIn  = parts[1].toUpperCase();
  const tokenOut = parts[2].toUpperCase();
  const amount   = parts[3];

  if (!TOKEN_LIST[tokenIn])  return sendMessage(env, chatId, `❌ Token "${tokenIn}" is not supported.`);
  if (!TOKEN_LIST[tokenOut]) return sendMessage(env, chatId, `❌ Token "${tokenOut}" is not supported.`);
  if (isNaN(Number(amount)) || Number(amount) <= 0) return sendMessage(env, chatId, "❌ Invalid amount.");

  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  await sendMessage(env, chatId, `⏳ Swapping ${amount} ${tokenIn} → ${tokenOut}...`);

  try {
    const res  = await fetch(env.VERCEL_SWAP_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privateKey: w.privateKey, tokenIn, tokenOut, amount }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "swap error");
    await sendMessage(env, chatId,
      `✅ *Swap completed!*\n\n${amount} ${tokenIn} → ${tokenOut}\n\n` +
      "`" + data.txHash + "`\n\n" +
      `🔗 [Explorer](${EXPLORER}/tx/${data.txHash})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Swap error: " + e.message);
  }
}

// ─── /multisend ─────────────────────────────────────────────────
async function handleMultiSend(env, chatId, msg) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  const lines     = msg.split("\n").map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0].split(" ");
  const isRandom  = firstLine[1]?.toLowerCase() === "random";
  let minAmt = 0, maxAmt = 0;

  if (isRandom) {
    minAmt = parseFloat(firstLine[2]);
    maxAmt = parseFloat(firstLine[3]);
    if (!minAmt || !maxAmt || minAmt >= maxAmt)
      return sendMessage(env, chatId, "❌ Random format: `/multisend random <min> <max>`");
  }

  const recipients = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(" ");
    const addr  = parts[0].trim();
    if (!isAddress(addr)) continue;
    const amount = isRandom
      ? (minAmt + Math.random() * (maxAmt - minAmt)).toFixed(6)
      : parts[1];
    if (!amount || isNaN(Number(amount))) continue;
    recipients.push({ to: addr, amount });
  }

  if (!recipients.length) return sendMessage(env, chatId,
    "❌ No valid addresses found.\n\n" +
    "Format 1: `/multisend\n0xAddr1 1.5\n0xAddr2 2.0`\n\n" +
    "Format 2: `/multisend random 1 5\n0xAddr1\n0xAddr2`"
  );

  const total = recipients.reduce((s, r) => s + Number(r.amount), 0);
  await sendMessage(env, chatId,
    `📤 *Starting batch send*\nRecipients: ${recipients.length}\nTotal: ${total.toFixed(6)} OPN\n⏳ Processing...`
  );

  try {
    const res  = await fetch(env.VERCEL_MULTISEND_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privateKey: w.privateKey, recipients }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "multisend error");

    const resultLines = data.results.map(r =>
      r.status === "sent"
        ? `✅ \`${r.to.slice(0,8)}...\` — ${r.amount} OPN\n[tx](${EXPLORER}/tx/${r.txHash})`
        : `❌ \`${r.to.slice(0,8)}...\` — ${r.error}`
    );
    await sendMessage(env, chatId, "📋 *Results:*\n\n" + resultLines.join("\n\n"));
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}


// ─── /deploytoken ────────────────────────────────────────────
// Format: /deploytoken <name> <symbol> <supply>
// Example: /deploytoken MyToken MTK 1000000
async function handleDeployToken(env, chatId, msg) {
  const parts = msg.split(" ");
  if (parts.length < 4) return sendMessage(env, chatId,
    "❌ Format: `/deploytoken <name> <symbol> <supply>`\n" +
    "Example: `/deploytoken MyToken MTK 1000000`"
  );

  const name       = parts[1].trim();
  const symbol     = parts[2].trim().toUpperCase();
  const totalSupply = parts[3].trim();

  if (!/^\d+$/.test(totalSupply)) return sendMessage(env, chatId, "❌ Supply must be a number.");
  if (symbol.length > 10)          return sendMessage(env, chatId, "❌ Symbol max 10 characters.");
  if (name.length > 32)            return sendMessage(env, chatId, "❌ Name max 32 characters.");

  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  await sendMessage(env, chatId,
    `⏳ Deploying token...\n\nName: ${name}\nSymbol: ${symbol}\nSupply: ${Number(totalSupply).toLocaleString()}`
  );

  try {
    const res  = await fetch(env.VERCEL_DEPLOY_TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        privateKey: w.privateKey,
        name, symbol, decimals: 18, totalSupply,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "deploy error");

    // remember tokens this user created so /mytokens can always show them
    if (data.contractAddress) {
      await addCreatedToken(env, chatId, {
        address:  data.contractAddress,
        symbol:   data.symbol,
        decimals: data.decimals ?? 18,
      });
    }

    await sendMessage(env, chatId,
      "✅ *Token deployed!*\n\n" +
      `Name: ${data.name}\n` +
      `Symbol: ${data.symbol}\n` +
      `Supply: ${Number(data.totalSupply).toLocaleString()}\n` +
      `Decimals: ${data.decimals}\n\n` +
      `📄 Contract:\n\`${data.contractAddress}\`\n\n` +
      `🔗 [Explorer](https://testnet.iopn.tech/address/${data.contractAddress})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Deploy error: " + e.message);
  }
}

// ─── /importwallet ───────────────────────────────────────────
// Format: /importwallet <privatekey>
async function handleImportWallet(env, chatId, msg) {
  const parts = msg.split(" ");
  if (parts.length < 2) return sendMessage(env, chatId,
    "❌ Format: `/importwallet <privatekey>`\n" +
    "⚠️ Only send private keys in a private chat!"
  );

  let privateKey = parts[1].trim();
  if (!privateKey.startsWith("0x")) privateKey = "0x" + privateKey;

  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    return sendMessage(env, chatId, "❌ Invalid private key format.");
  }

  try {
    // derive address from private key using Vercel API
    const userKey = `user:${chatId}`;
    const existing = await env.WALLETS.get(userKey);

    // backup existing wallet
    if (existing) {
      const old = JSON.parse(existing);
      await env.WALLETS.put(`user:${chatId}:backup`, JSON.stringify(old));
    }

    // save new wallet — address derived via Vercel API
    const walletRes  = await fetch(env.VERCEL_WALLET_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importPrivateKey: privateKey }),
    });
    const walletData = await walletRes.json();
    if (!walletRes.ok) throw new Error(walletData.error || "API error");

    let address = walletData.address;
    if (!address) {
      throw new Error("Could not derive address from private key.");
    }

    const wallet = { address, privateKey };
    await env.WALLETS.put(userKey, JSON.stringify(wallet));

    const bal = await getNativeBalance(address);

    await sendMessage(env, chatId,
      "✅ *Wallet imported!*\n\n" +
      `📬 Address:\n\`${address}\`\n\n` +
      `💰 Balance: \`${bal.toFixed(6)} OPN\`\n\n` +
      `🔗 [Explorer](https://testnet.iopn.tech/address/${address})`
    );
  } catch (e) {
    await sendMessage(env, chatId, "❌ Import error: " + e.message);
  }
}

// ─── RPC Helpers ────────────────────────────────────────────────
// ─── /addliquidity ──────────────────────────────────────────────────────
// Format: /addliquidity <tokenA> <tokenB> <amountA> <amountB>
async function handleAddLiquidity(env, chatId, msg) {
  const parts = msg.split(/\s+/);
  if (parts.length < 5) return sendMessage(env, chatId,
    "❌ Format: `/addliquidity <tokenA> <tokenB> <amountA> <amountB>`\n" +
    "Example: `/addliquidity OPN TUSDT 0.1 5`\n\n" +
    "Use a token symbol or a 0x contract address.\n" +
    "Supported symbols: " + Object.keys(TOKEN_LIST).join(", "));

  const tokenA = parts[1], tokenB = parts[2], amountA = parts[3], amountB = parts[4];
  if (isNaN(Number(amountA)) || Number(amountA) <= 0 || isNaN(Number(amountB)) || Number(amountB) <= 0)
    return sendMessage(env, chatId, "❌ Invalid amounts.");
  if (tokenA.toUpperCase() === tokenB.toUpperCase())
    return sendMessage(env, chatId, "❌ Token A and Token B must differ.");

  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  await sendMessage(env, chatId,
    `⏳ Adding liquidity...\n${amountA} ${tokenA.toUpperCase()} + ${amountB} ${tokenB.toUpperCase()}`);

  try {
    const res  = await fetch(env.VERCEL_ADD_LIQUIDITY_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privateKey: w.privateKey, tokenA, tokenB, amountA, amountB }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "add liquidity error");
    await sendMessage(env, chatId,
      "✅ *Liquidity added!*\n\n`" + data.txHash + "`\n\n" +
      `🔗 [Explorer](${EXPLORER}/tx/${data.txHash})`);
  } catch (e) {
    await sendMessage(env, chatId, "❌ Add liquidity error: " + e.message);
  }
}

// ─── /removeliquidity ───────────────────────────────────────────────────
// Format: /removeliquidity <tokenA> <tokenB> <percent>  (percent 1–100)
async function handleRemoveLiquidity(env, chatId, msg) {
  const parts = msg.split(/\s+/);
  if (parts.length < 4) return sendMessage(env, chatId,
    "❌ Format: `/removeliquidity <tokenA> <tokenB> <percent>`\n" +
    "Example: `/removeliquidity OPN TUSDT 100`\n" +
    "(percent of your LP to remove, 1–100)");

  const tokenA = parts[1], tokenB = parts[2];
  const pct = Number(parts[3].replace("%", ""));
  if (isNaN(pct) || pct <= 0 || pct > 100)
    return sendMessage(env, chatId, "❌ Percent must be between 1 and 100.");

  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");

  await sendMessage(env, chatId,
    `⏳ Removing ${pct}% liquidity from ${tokenA.toUpperCase()}/${tokenB.toUpperCase()}...`);

  try {
    const res  = await fetch(env.VERCEL_REMOVE_LIQUIDITY_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privateKey: w.privateKey, tokenA, tokenB, percent: pct }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "remove liquidity error");
    await sendMessage(env, chatId,
      "✅ *Liquidity removed!*\n\n`" + data.txHash + "`\n\n" +
      `🔗 [Explorer](${EXPLORER}/tx/${data.txHash})`);
  } catch (e) {
    await sendMessage(env, chatId, "❌ Remove liquidity error: " + e.message);
  }
}

// ─── /mytokens — discover ALL tokens held by the wallet ──────────────────
// Sources: built-in list + tokens the user created (KV) + every token that
// has a pool on the DEX factory. Then balanceOf each and show balance > 0.
async function handleMyTokens(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  await sendMessage(env, chatId, "⏳ Scanning all your tokens...");

  try {
    const builtin = {}; // addr(lower) -> { symbol, decimals }
    for (const k of Object.keys(TOKEN_LIST)) {
      const t = TOKEN_LIST[k];
      if (t.address) builtin[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals };
    }

    const created = await getCreatedTokens(env, chatId);
    const createdSet = new Set(created.map(c => c.address.toLowerCase()));
    for (const t of created)
      builtin[t.address.toLowerCase()] = { symbol: t.symbol || "?", decimals: t.decimals ?? 18 };

    let dexTokens = [];
    try { dexTokens = await getAllDexTokens(); } catch {}

    const addrs = [...new Set([...Object.keys(builtin), ...dexTokens])];

    // batch balanceOf
    const balRes = await rpcBatch(addrs.map(a => ethCallObj(a, SEL.balanceOf + addrParam(w.address))));
    const held = [], needMeta = [];
    addrs.forEach((a, i) => {
      const raw = balRes[i];
      const bal = raw && raw !== "0x" ? BigInt(raw) : 0n;
      if (bal > 0n) { held.push({ address: a, bal }); if (!builtin[a]) needMeta.push(a); }
    });

    // metadata for unknown held tokens
    const meta = {};
    if (needMeta.length) {
      const mCalls = [];
      for (const a of needMeta) { mCalls.push(ethCallObj(a, SEL.symbol)); mCalls.push(ethCallObj(a, SEL.decimals)); }
      const mRes = await rpcBatch(mCalls);
      needMeta.forEach((a, i) => {
        const sym    = decodeAbiString(mRes[i * 2]);
        const decHex = mRes[i * 2 + 1];
        const dec    = decHex && decHex !== "0x" ? parseInt(decHex, 16) : 18;
        meta[a] = { symbol: sym || (a.slice(0, 6) + "…"), decimals: dec };
      });
    }

    const opn   = await getNativeBalance(w.address);
    const lines = [`• *OPN*: \`${opn.toFixed(6)}\`  _(native)_`];
    for (const h of held) {
      const m   = builtin[h.address] || meta[h.address] || { symbol: "?", decimals: 18 };
      const amt = Number(h.bal) / (10 ** m.decimals);
      const tag = createdSet.has(h.address) ? "  🆕" : "";
      lines.push(`• *${m.symbol}*: \`${amt.toFixed(6)}\`${tag}\n  \`${h.address}\``);
    }

    await sendMessage(env, chatId,
      "🪙 *Your Tokens*\n\n`" + w.address + "`\n\n" +
      lines.join("\n") + "\n\n" +
      "🆕 = a token you created\n" +
      `🔗 [Explorer](${EXPLORER}/address/${w.address})`);
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

// ─── /mypools — the wallet's liquidity positions ─────────────────────────
async function handleMyPools(env, chatId) {
  const w = await getWallet(env, chatId);
  if (!w) return sendMessage(env, chatId, "❌ Please create a wallet first: /wallet");
  await sendMessage(env, chatId, "⏳ Loading your liquidity positions...");

  try {
    const lenHex = (await rpcBatch([ethCallObj(FACTORY_ADDRESS, SEL.allPairsLength)]))[0];
    const len = lenHex ? parseInt(lenHex, 16) : 0;
    if (!len) return sendMessage(env, chatId, "No pools exist on the DEX yet.");

    const pairCalls = [];
    for (let i = 0; i < len; i++)
      pairCalls.push(ethCallObj(FACTORY_ADDRESS, SEL.allPairs + pad32(i.toString(16))));
    const pairs = (await rpcBatch(pairCalls)).filter(Boolean).map(r => "0x" + r.slice(-40));

    const balRes = await rpcBatch(pairs.map(p => ethCallObj(p, SEL.balanceOf + addrParam(w.address))));
    const mine = [];
    pairs.forEach((p, i) => {
      const r = balRes[i]; const b = r && r !== "0x" ? BigInt(r) : 0n;
      if (b > 0n) mine.push({ pair: p, lp: b });
    });
    if (!mine.length) return sendMessage(env, chatId,
      "🌊 You have no liquidity positions yet.\n\nUse `/addliquidity` to provide liquidity.");

    const calls = [];
    for (const m of mine)
      calls.push(ethCallObj(m.pair, SEL.token0), ethCallObj(m.pair, SEL.token1),
                 ethCallObj(m.pair, SEL.totalSupply), ethCallObj(m.pair, SEL.getReserves));
    const res = await rpcBatch(calls);

    const tokenSet = new Set();
    mine.forEach((m, i) => {
      m.t0 = ("0x" + (res[i * 4]     || "").slice(-40)).toLowerCase();
      m.t1 = ("0x" + (res[i * 4 + 1] || "").slice(-40)).toLowerCase();
      tokenSet.add(m.t0); tokenSet.add(m.t1);
    });
    const symMap = await getSymbols([...tokenSet]);

    const lines = [];
    mine.forEach((m, i) => {
      const ts = res[i * 4 + 2] && res[i * 4 + 2] !== "0x" ? BigInt(res[i * 4 + 2]) : 0n;
      const rr = (res[i * 4 + 3] || "").replace("0x", "");
      const r0 = rr.length >= 64  ? BigInt("0x" + rr.slice(0, 64))   : 0n;
      const r1 = rr.length >= 128 ? BigInt("0x" + rr.slice(64, 128)) : 0n;
      const share = ts > 0n ? Number(m.lp * 1000000n / ts) / 10000 : 0;
      const s0 = symMap[m.t0] || "?", s1 = symMap[m.t1] || "?";
      const amt0 = ts > 0n ? Number(r0 * m.lp / ts) / 1e18 : 0;
      const amt1 = ts > 0n ? Number(r1 * m.lp / ts) / 1e18 : 0;
      lines.push(
        `*${s0}/${s1}*\n` +
        `  LP: \`${(Number(m.lp) / 1e18).toFixed(6)}\` (${share.toFixed(2)}%)\n` +
        `  ≈ ${amt0.toFixed(4)} ${s0} + ${amt1.toFixed(4)} ${s1}`);
    });

    await sendMessage(env, chatId,
      "🌊 *Your Liquidity Positions*\n\n" + lines.join("\n\n") +
      "\n\nUse `/removeliquidity <A> <B> <percent>` to withdraw.");
  } catch (e) {
    await sendMessage(env, chatId, "❌ Error: " + e.message);
  }
}

// ─── Created-token tracking (KV) ─────────────────────────────────────────
async function getCreatedTokens(env, chatId) {
  try {
    const raw = await env.WALLETS.get(`tokens:${chatId}`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function addCreatedToken(env, chatId, t) {
  try {
    const cur = await getCreatedTokens(env, chatId);
    const lc  = (t.address || "").toLowerCase();
    if (!lc || cur.some(x => x.address.toLowerCase() === lc)) return;
    cur.push({ address: t.address, symbol: t.symbol || "?", decimals: t.decimals ?? 18 });
    await env.WALLETS.put(`tokens:${chatId}`, JSON.stringify(cur));
  } catch {}
}

// ─── DEX read helpers (raw batched RPC) ──────────────────────────────────
const SEL = {
  balanceOf:      "0x70a08231",
  symbol:         "0x95d89b41",
  decimals:       "0x313ce567",
  totalSupply:    "0x18160ddd",
  token0:         "0x0dfe1681",
  token1:         "0xd21220a7",
  getReserves:    "0x0902f1ac",
  allPairsLength: "0x574f2ba3",
  allPairs:       "0x1e3dd18b",
  getPair:        "0xe6a43905",
};

function pad32(hexNo0x)   { return hexNo0x.padStart(64, "0"); }
function addrParam(addr)  { return pad32(addr.toLowerCase().replace("0x", "")); }
function ethCallObj(to, data) { return { method: "eth_call", params: [{ to, data }, "latest"] }; }

// Batched JSON-RPC. calls: [{method, params}] → results array (null on error).
async function rpcBatch(calls) {
  if (!calls.length) return [];
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  const res  = await fetch(RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const out  = new Array(calls.length).fill(null);
  for (const item of (Array.isArray(data) ? data : [data]))
    if (item && typeof item.id === "number") out[item.id] = item.error ? null : item.result;
  return out;
}

// decode an ABI-encoded `string` return value (offset, length, bytes)
function decodeAbiString(hex) {
  try {
    if (!hex || hex === "0x") return "";
    const h   = hex.replace("0x", "");
    const len = parseInt(h.slice(64, 128), 16);
    const data = h.slice(128, 128 + len * 2);
    let s = "";
    for (let i = 0; i < data.length; i += 2) {
      const code = parseInt(data.slice(i, i + 2), 16);
      if (code) s += String.fromCharCode(code);
    }
    return s;
  } catch { return ""; }
}

// every token address that appears in any DEX pool (excludes WOPN), lowercased
async function getAllDexTokens() {
  const lenHex = (await rpcBatch([ethCallObj(FACTORY_ADDRESS, SEL.allPairsLength)]))[0];
  const len = lenHex ? parseInt(lenHex, 16) : 0;
  if (!len) return [];
  const pairCalls = [];
  for (let i = 0; i < len; i++)
    pairCalls.push(ethCallObj(FACTORY_ADDRESS, SEL.allPairs + pad32(i.toString(16))));
  const pairs = (await rpcBatch(pairCalls)).filter(Boolean).map(r => "0x" + r.slice(-40));
  const tCalls = [];
  for (const p of pairs) { tCalls.push(ethCallObj(p, SEL.token0)); tCalls.push(ethCallObj(p, SEL.token1)); }
  const tRes = await rpcBatch(tCalls);
  const set = new Set();
  for (const r of tRes)
    if (r) { const a = ("0x" + r.slice(-40)).toLowerCase(); if (a !== WOPN_ADDRESS.toLowerCase()) set.add(a); }
  return [...set];
}

// resolve token addresses → symbols (WOPN shown as OPN; built-ins known; rest on-chain)
async function getSymbols(addrs) {
  const out = {};
  const builtinByAddr = {};
  for (const k of Object.keys(TOKEN_LIST)) {
    const t = TOKEN_LIST[k];
    if (t.address) builtinByAddr[t.address.toLowerCase()] = t.symbol;
  }
  const need = [];
  for (const a of addrs) {
    const lc = a.toLowerCase();
    if (lc === WOPN_ADDRESS.toLowerCase()) out[lc] = "OPN";
    else if (builtinByAddr[lc])            out[lc] = builtinByAddr[lc];
    else need.push(lc);
  }
  if (need.length) {
    const res = await rpcBatch(need.map(a => ethCallObj(a, SEL.symbol)));
    need.forEach((a, i) => { out[a] = decodeAbiString(res[i]) || (a.slice(0, 6) + "…"); });
  }
  return out;
}

async function rpc(method, params) {
  const res  = await fetch(RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

async function getNativeBalance(address) {
  const hex = await rpc("eth_getBalance", [address, "latest"]);
  return Number(BigInt(hex)) / 1e18;
}

async function getTokenBalance(tokenAddress, walletAddress, decimals) {
  if (!tokenAddress) return getNativeBalance(walletAddress);
  const data = "0x70a08231" + walletAddress.replace("0x","").padStart(64,"0");
  const res  = await rpc("eth_call", [{ to: tokenAddress, data }, "latest"]);
  if (!res || res === "0x") return 0;
  return Number(BigInt(res)) / (10 ** decimals);
}

// ─── Utils ──────────────────────────────────────────────────────
function isAddress(str) {
  return /^0x[0-9a-fA-F]{40}$/.test(str);
}

async function getWallet(env, chatId) {
  const data = await env.WALLETS.get(`user:${chatId}`);
  return data ? JSON.parse(data) : null;
}

// ─── Telegram Helpers ──────────────────────────────────────────
async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown",
      disable_web_page_preview: true }),
  });
}

async function sendWithKeyboard(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [
        [{ text: "👛 Wallet", callback_data: "wallet" },   { text: "👤 Profile",   callback_data: "profile" }],
        [{ text: "🪙 My Tokens", callback_data: "mytokens" }, { text: "🌊 My Pools", callback_data: "mypools" }],
        [{ text: "🔄 Swap",   callback_data: "swap" },     { text: "💸 Send",      callback_data: "send" }],
        [{ text: "➕ Add Liq", callback_data: "addliquidity" }, { text: "➖ Remove Liq", callback_data: "removeliquidity" }],
        [{ text: "📤 MultiSend", callback_data: "multisend" }, { text: "📜 History", callback_data: "history" }],
        [{ text: "🌐 Network",callback_data: "network" },  { text: "🪙 Faucet",    callback_data: "faucet" }],
        [{ text: "🚀 Deploy Token", callback_data: "deploytoken" }, { text: "🔑 Import Wallet", callback_data: "importwallet" }],
      ]}
    }),
  });
}

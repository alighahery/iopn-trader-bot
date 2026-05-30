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
// ============================================================

const RPC_URL  = "https://testnet-rpc.iopn.tech";
const EXPLORER = "https://testnet.iopn.tech";
const CHAIN_ID = 984;

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
    if (d === "multisend") return send(chatId, "📤 Format:\n`/multisend\n0xAddr1 1.5\n0xAddr2 2.0`\nor random:\n`/multisend random 1 5\n0xAddr1\n0xAddr2`");
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
    "• `/multisend` — Batch send\n" +
    "• `/network` — Network info\n" +
    "• `/faucet` — Get testnet OPN"
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

// ─── RPC Helpers ────────────────────────────────────────────────
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
        [{ text: "💸 Send",   callback_data: "send" },     { text: "📜 History",   callback_data: "history" }],
        [{ text: "🔄 Swap",   callback_data: "swap" },     { text: "📤 MultiSend", callback_data: "multisend" }],
        [{ text: "🌐 Network",callback_data: "network" },  { text: "🪙 Faucet",    callback_data: "faucet" }],
      ]}
    }),
  });
}

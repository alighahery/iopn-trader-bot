import { JsonRpcProvider, Wallet, parseUnits, parseEther, Contract, MaxUint256 } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL        = "https://testnet-rpc.iopn.tech"
const CHAIN_ID       = 984
const ROUTER_ADDRESS = "0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885"
const WOPN_ADDRESS   = "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84"

// Built-in tokens (symbol -> address/decimals). address:null means native OPN.
const TOKEN_MAP: Record<string, { address: string | null; decimals: number }> = {
  OPN:   { address: null,            decimals: 18 },
  OPNT:  { address: "0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d", decimals: 18 },
  TBNB:  { address: "0x92cF36713a5622351c9489D5556B90B321873607", decimals: 18 },
  TUSDT: { address: "0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b", decimals: 18 },
  WOPN:  { address: "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84", decimals: 18 },
  IRR:   { address: "0xf250aB45BDE152fDe5c1F009f621069730d3D574", decimals: 18 },
}

// IOPn router uses OPN naming (NOT ETH). Signatures verified against the DEX frontend.
const ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function addLiquidityOPN(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountOPNMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountOPN, uint256 liquidity)",
]

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s)

async function getGasPrice(provider: JsonRpcProvider) {
  const fd     = await provider.getFeeData()
  const minGas = BigInt("10000000000") // 10 Gwei floor
  return (fd.gasPrice && fd.gasPrice > minGas) ? fd.gasPrice : minGas
}

// Resolve a token reference (symbol OR 0x address) to { address|null, decimals }.
// address === null means native OPN.
async function resolveToken(ref: string, provider: JsonRpcProvider) {
  const key = ref.trim()
  const up  = key.toUpperCase()
  if (TOKEN_MAP[up]) return { ...TOKEN_MAP[up] }
  if (isAddr(key)) {
    const c = new Contract(key, ERC20_ABI, provider)
    let decimals = 18
    try { decimals = Number(await c.decimals()) } catch {}
    return { address: key, decimals }
  }
  throw new Error(`Unsupported token: ${ref}`)
}

const applyMin = (amount: bigint, slippageBps: number) =>
  amount * BigInt(10000 - slippageBps) / 10000n

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { privateKey, tokenA, tokenB, amountA, amountB, slippageBps } = body

    if (!privateKey || !tokenA || !tokenB || amountA == null || amountB == null) {
      return NextResponse.json(
        { error: "Missing: privateKey, tokenA, tokenB, amountA, amountB" },
        { status: 400 }
      )
    }
    const slip = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 100 // 1% default

    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID)
    const wallet   = new Wallet(privateKey, provider)
    const router   = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
    const gasPrice = await getGasPrice(provider)

    const a = await resolveToken(tokenA, provider)
    const b = await resolveToken(tokenB, provider)

    if (a.address === null && b.address === null) {
      return NextResponse.json({ error: "Both sides cannot be native OPN" }, { status: 400 })
    }

    const amtAWei = parseUnits(amountA.toString(), a.decimals)
    const amtBWei = parseUnits(amountB.toString(), b.decimals)

    // ensure ERC20 approval to router (uses MaxUint256 once)
    async function ensureApproval(tokenAddr: string, needed: bigint) {
      const erc20 = new Contract(tokenAddr, ERC20_ABI, wallet)
      const allow: bigint = await erc20.allowance(wallet.address, ROUTER_ADDRESS)
      if (allow < needed) {
        const tx = await erc20.approve(ROUTER_ADDRESS, MaxUint256, { gasPrice })
        await tx.wait(1)
      }
    }

    let tx

    // ── one side is native OPN → addLiquidityOPN ───────────────────────────
    if (a.address === null || b.address === null) {
      const native = a.address === null ? a : b
      const token  = a.address === null ? b : a
      const nativeAmt = a.address === null ? amtAWei : amtBWei
      const tokenAmt  = a.address === null ? amtBWei : amtAWei

      await ensureApproval(token.address!, tokenAmt)

      // mins = 0: the router pulls the optimal ratio. Hard mins revert when the
      // pool already exists at a different ratio (INSUFFICIENT_*_AMOUNT).
      // High gas limit: creating a brand-new pair deploys a Pair contract (~2.5M gas).
      tx = await router.addLiquidityOPN(
        token.address!,
        tokenAmt,
        0n,
        0n,
        wallet.address,
        deadline,
        { value: nativeAmt, gasPrice, gasLimit: 3000000n }
      )
    }
    // ── both ERC20 → addLiquidity ──────────────────────────────────────────
    else {
      await ensureApproval(a.address, amtAWei)
      await ensureApproval(b.address, amtBWei)

      tx = await router.addLiquidity(
        a.address, b.address,
        amtAWei, amtBWei,
        0n, 0n,
        wallet.address,
        deadline,
        { gasPrice, gasLimit: 3000000n }
      )
    }

    console.log("addLiquidity tx sent:", tx.hash)
    // Wait for the receipt so we report REAL success/failure (not just "submitted").
    const receipt = await tx.wait(1)
    if (!receipt || receipt.status !== 1) {
      return NextResponse.json(
        { error: "Transaction reverted on-chain", txHash: tx.hash, status: "failed" },
        { status: 500 }
      )
    }
    return NextResponse.json({ txHash: tx.hash, status: "confirmed" })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Add liquidity error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

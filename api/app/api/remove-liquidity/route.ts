import { JsonRpcProvider, Wallet, parseUnits, Contract, MaxUint256, ZeroAddress } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL         = "https://testnet-rpc.iopn.tech"
const CHAIN_ID        = 984
const ROUTER_ADDRESS  = "0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885"
const FACTORY_ADDRESS = "0x8860242B65611dfd077aEe26C3C7920813dF9208"
const WOPN_ADDRESS    = "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84"

const TOKEN_MAP: Record<string, { address: string | null; decimals: number }> = {
  OPN:   { address: null,            decimals: 18 },
  OPNT:  { address: "0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d", decimals: 18 },
  TBNB:  { address: "0x92cF36713a5622351c9489D5556B90B321873607", decimals: 18 },
  TUSDT: { address: "0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b", decimals: 18 },
  WOPN:  { address: "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84", decimals: 18 },
  IRR:   { address: "0xf250aB45BDE152fDe5c1F009f621069730d3D574", decimals: 18 },
}

const ROUTER_ABI = [
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB)",
  "function removeLiquidityOPN(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountOPNMin, address to, uint256 deadline) external returns (uint256 amountToken, uint256 amountOPN)",
]
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) view returns (address)"]
const PAIR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 ts)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s)

async function getGasPrice(provider: JsonRpcProvider) {
  const fd     = await provider.getFeeData()
  const minGas = BigInt("10000000000")
  return (fd.gasPrice && fd.gasPrice > minGas) ? fd.gasPrice : minGas
}

async function resolveToken(ref: string, provider: JsonRpcProvider) {
  const up = ref.trim().toUpperCase()
  if (TOKEN_MAP[up]) return { ...TOKEN_MAP[up] }
  if (isAddr(ref.trim())) {
    const c = new Contract(ref.trim(), ["function decimals() view returns (uint8)"], provider)
    let decimals = 18
    try { decimals = Number(await c.decimals()) } catch {}
    return { address: ref.trim(), decimals }
  }
  throw new Error(`Unsupported token: ${ref}`)
}

const applyMin = (amount: bigint, slippageBps: number) =>
  amount * BigInt(10000 - slippageBps) / 10000n

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { privateKey, tokenA, tokenB, liquidity, percent, slippageBps } = body

    if (!privateKey || !tokenA || !tokenB) {
      return NextResponse.json({ error: "Missing: privateKey, tokenA, tokenB" }, { status: 400 })
    }
    const slip = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 500 // 5% default for removal

    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID)
    const wallet   = new Wallet(privateKey, provider)
    const router   = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet)
    const factory  = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
    const gasPrice = await getGasPrice(provider)

    const a = await resolveToken(tokenA, provider)
    const b = await resolveToken(tokenB, provider)
    if (a.address === null && b.address === null) {
      return NextResponse.json({ error: "Both sides cannot be native OPN" }, { status: 400 })
    }

    // pools use WOPN for the native side
    const addrA = a.address ?? WOPN_ADDRESS
    const addrB = b.address ?? WOPN_ADDRESS

    const pairAddr: string = await factory.getPair(addrA, addrB)
    if (!pairAddr || pairAddr === ZeroAddress) {
      return NextResponse.json({ error: "No liquidity pool exists for this pair" }, { status: 400 })
    }

    const pair      = new Contract(pairAddr, PAIR_ABI, wallet)
    const lpBalance: bigint = await pair.balanceOf(wallet.address)
    if (lpBalance === 0n) {
      return NextResponse.json({ error: "You have no LP tokens in this pool" }, { status: 400 })
    }

    // determine how much LP to remove
    let lpAmount: bigint
    if (percent != null) {
      const pct = Math.max(1, Math.min(100, Number(percent)))
      lpAmount = lpBalance * BigInt(Math.round(pct * 100)) / 10000n
    } else if (liquidity != null && liquidity !== "" &&
               liquidity.toString().toLowerCase() !== "max" &&
               liquidity.toString().toLowerCase() !== "all") {
      lpAmount = parseUnits(liquidity.toString(), 18)
      if (lpAmount > lpBalance) lpAmount = lpBalance
    } else {
      lpAmount = lpBalance // max / all
    }
    if (lpAmount === 0n) {
      return NextResponse.json({ error: "Computed LP amount is zero" }, { status: 400 })
    }

    // approve LP token (the pair) to the router
    const allow: bigint = await pair.allowance(wallet.address, ROUTER_ADDRESS)
    if (allow < lpAmount) {
      const tx = await pair.approve(ROUTER_ADDRESS, MaxUint256, { gasPrice })
      await tx.wait(1)
    }

    let tx

    // mins = 0 to avoid revert from tiny reserve-rounding differences (testnet).
    // ── one side native OPN → removeLiquidityOPN ───────────────────────────
    if (a.address === null || b.address === null) {
      const tokenIsA = b.address === null            // the ERC20 side
      const token    = tokenIsA ? a : b
      tx = await router.removeLiquidityOPN(
        token.address!,
        lpAmount,
        0n,
        0n,
        wallet.address,
        deadline,
        { gasPrice, gasLimit: 1000000n }
      )
    }
    // ── both ERC20 → removeLiquidity ───────────────────────────────────────
    else {
      tx = await router.removeLiquidity(
        a.address, b.address,
        lpAmount,
        0n, 0n,
        wallet.address,
        deadline,
        { gasPrice, gasLimit: 1000000n }
      )
    }

    console.log("removeLiquidity tx sent:", tx.hash)
    const receipt = await tx.wait(1)
    if (!receipt || receipt.status !== 1) {
      return NextResponse.json(
        { error: "Transaction reverted on-chain", txHash: tx.hash, status: "failed" },
        { status: 500 }
      )
    }
    return NextResponse.json({ txHash: tx.hash, lpRemoved: lpAmount.toString(), status: "confirmed" })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Remove liquidity error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

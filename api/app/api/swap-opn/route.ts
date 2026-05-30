import { JsonRpcProvider, Wallet, parseEther, parseUnits, Contract } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL        = "https://testnet-rpc.iopn.tech"
const CHAIN_ID       = 984
const ROUTER_ADDRESS = "0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885"
const WOPN_ADDRESS   = "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84"

const TOKEN_MAP: Record<string, { address: string | null; decimals: number }> = {
  OPN:   { address: null,                                         decimals: 18 },
  OPNT:  { address: "0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d", decimals: 18 },
  TBNB:  { address: "0x92cF36713a5622351c9489D5556B90B321873607", decimals: 18 },
  TUSDT: { address: "0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b", decimals: 18 },
  WOPN:  { address: "0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84", decimals: 18 },
  IRR:   { address: "0xf250aB45BDE152fDe5c1F009f621069730d3D574", decimals: 18 },
}

const ROUTER_ABI = [
  "function swapExactOPNForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)",
  "function swapExactTokensForOPN(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
]

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]

// WOPN follows WETH pattern: deposit/withdraw
const WOPN_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
]

async function getGasPrice(provider: JsonRpcProvider) {
  const fd     = await provider.getFeeData()
  const minGas = BigInt("10000000000") // 10 Gwei
  return (fd.gasPrice && fd.gasPrice > minGas) ? fd.gasPrice : minGas
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { privateKey, tokenIn, tokenOut, amount } = body

    if (!privateKey || !tokenIn || !tokenOut || !amount) {
      return NextResponse.json({ error: "Missing: privateKey, tokenIn, tokenOut, amount" }, { status: 400 })
    }

    const inKey  = tokenIn.toUpperCase()
    const outKey = tokenOut.toUpperCase()
    const inInfo  = TOKEN_MAP[inKey]
    const outInfo = TOKEN_MAP[outKey]

    if (!inInfo)  return NextResponse.json({ error: `Unsupported: ${tokenIn}` },  { status: 400 })
    if (!outInfo) return NextResponse.json({ error: `Unsupported: ${tokenOut}` }, { status: 400 })

    const provider  = new JsonRpcProvider(RPC_URL, CHAIN_ID)
    const wallet    = new Wallet(privateKey, provider)
    const deadline  = BigInt(Math.floor(Date.now() / 1000) + 1200)
    const gasPrice  = await getGasPrice(provider)
    const amountWei = parseUnits(amount.toString(), inInfo.decimals)

    let tx

    // ─── OPN → WOPN: wrap using deposit() ────────────────────────
    if (!inInfo.address && outKey === "WOPN") {
      const wopn = new Contract(WOPN_ADDRESS, WOPN_ABI, wallet)
      tx = await wopn.deposit({ value: amountWei, gasPrice, gasLimit: 60000n })
    }

    // ─── WOPN → OPN: unwrap using withdraw() ─────────────────────
    else if (inKey === "WOPN" && !outInfo.address) {
      const wopn = new Contract(WOPN_ADDRESS, WOPN_ABI, wallet)
      tx = await wopn.withdraw(amountWei, { gasPrice, gasLimit: 60000n })
    }

    // ─── OPN → Token (non-WOPN) ──────────────────────────────────
    else if (!inInfo.address) {
      const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet)
      const path   = [WOPN_ADDRESS, outInfo.address!]
      tx = await router.swapExactOPNForTokens(
        0n, path, wallet.address, deadline,
        { value: amountWei, gasPrice, gasLimit: 300000n }
      )
    }

    // ─── Token → OPN ─────────────────────────────────────────────
    else if (!outInfo.address) {
      const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet)
      const erc20  = new Contract(inInfo.address!, ERC20_ABI, wallet)
      const path   = [inInfo.address!, WOPN_ADDRESS]
      const allow  = await erc20.allowance(wallet.address, ROUTER_ADDRESS)
      if (allow < amountWei) {
        const approveTx = await erc20.approve(ROUTER_ADDRESS, amountWei, { gasPrice })
        await approveTx.wait(1)
      }
      tx = await router.swapExactTokensForOPN(
        amountWei, 0n, path, wallet.address, deadline,
        { gasPrice, gasLimit: 300000n }
      )
    }

    // ─── Token → Token (via WOPN) ────────────────────────────────
    else {
      const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet)
      const erc20  = new Contract(inInfo.address!, ERC20_ABI, wallet)
      const path   = [inInfo.address!, WOPN_ADDRESS, outInfo.address!]
      const allow  = await erc20.allowance(wallet.address, ROUTER_ADDRESS)
      if (allow < amountWei) {
        const approveTx = await erc20.approve(ROUTER_ADDRESS, amountWei, { gasPrice })
        await approveTx.wait(1)
      }
      tx = await router.swapExactTokensForTokens(
        amountWei, 0n, path, wallet.address, deadline,
        { gasPrice, gasLimit: 300000n }
      )
    }

    console.log("tx sent:", tx.hash)
    return NextResponse.json({ txHash: tx.hash })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Swap error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

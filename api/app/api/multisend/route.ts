import { JsonRpcProvider, Wallet, parseEther, parseUnits, Contract } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL  = "https://testnet-rpc.iopn.tech"
const CHAIN_ID = 984

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]

// recipients: [{ to: "0x...", amount: "1.5" }]
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { privateKey, recipients, tokenAddress } = body

    if (!privateKey || !recipients || !Array.isArray(recipients)) {
      return NextResponse.json({ error: "Missing: privateKey, recipients[]" }, { status: 400 })
    }

    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID)
    const wallet   = new Wallet(privateKey, provider)

    const results = []

    for (const r of recipients) {
      try {
        let tx
        if (!tokenAddress) {
          // native OPN transfer
          tx = await wallet.sendTransaction({
            to: r.to,
            value: parseEther(r.amount.toString()),
          })
        } else {
          // ERC20 token transfer
          const token    = new Contract(tokenAddress, ERC20_ABI, wallet)
          const decimals = await token.decimals().catch(() => 18)
          const amount   = parseUnits(r.amount.toString(), decimals)
          tx = await token.transfer(r.to, amount)
        }
        results.push({ to: r.to, amount: r.amount, txHash: tx.hash, status: "sent" })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error"
        results.push({ to: r.to, amount: r.amount, status: "failed", error: msg })
      }
      // small delay between transactions to avoid nonce conflicts
      await new Promise(r => setTimeout(r, 1500))
    }

    return NextResponse.json({ results })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

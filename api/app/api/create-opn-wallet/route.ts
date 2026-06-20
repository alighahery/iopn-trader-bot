import { Wallet } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { importPrivateKey } = body

    let wallet: Wallet

    if (importPrivateKey) {
      // ─── Import existing wallet ───────────────────────────
      let pk = importPrivateKey.trim()
      if (!pk.startsWith("0x")) pk = "0x" + pk
      if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
        return NextResponse.json({ error: "Invalid private key format" }, { status: 400 })
      }
      wallet = new Wallet(pk)
      return NextResponse.json({
        address:    wallet.address,
        privateKey: wallet.privateKey,
        imported:   true,
      })
    } else {
      // ─── Create new wallet ────────────────────────────────
      wallet = Wallet.createRandom()
      return NextResponse.json({
        address:    wallet.address,
        privateKey: wallet.privateKey,
        imported:   false,
      })
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("Wallet error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

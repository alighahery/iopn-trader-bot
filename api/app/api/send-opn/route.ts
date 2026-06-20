import { JsonRpcProvider, Wallet, parseEther } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL  = "https://testnet-rpc.iopn.tech"
const CHAIN_ID = 984

export async function POST(request: NextRequest) {
  let to = "", amount = "", privateKey = ""
  try {
    const body = await request.json()
    to         = body.to
    amount     = body.amount
    privateKey = body.privateKey

    if (!to || !amount || !privateKey) {
      return NextResponse.json({ error: "Missing: to, amount, privateKey" }, { status: 400 })
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 })
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return NextResponse.json({ error: "Invalid private key" }, { status: 400 })
    }

    // provider بدون chainId — بذار خودش detect کنه
    const provider = new JsonRpcProvider(RPC_URL)
    const wallet   = new Wallet(privateKey, provider)

    console.log("sender:", wallet.address)
    console.log("to:", to, "amount:", amount)

    // balance چک
    const balance = await provider.getBalance(wallet.address)
    console.log("balance:", balance.toString())

    // gasPrice
    const feeData  = await provider.getFeeData()
    const gasPrice = feeData.gasPrice ?? BigInt("10000000000")
    console.log("gasPrice:", gasPrice.toString())

    const valueWei = parseEther(amount.toString())
    console.log("value:", valueWei.toString())

    const tx = await wallet.sendTransaction({
      to,
      value:    valueWei,
      gasLimit: 21000n,
      gasPrice,
    })

    console.log("txHash:", tx.hash)
    return NextResponse.json({ txHash: tx.hash })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Transaction error:", msg)
    // خطا رو کامل برمیگردونیم
    return NextResponse.json({
      error: msg,
      debug: { to, amount, hasKey: !!privateKey }
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 })
}

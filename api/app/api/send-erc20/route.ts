import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from "ethers"
import { type NextRequest, NextResponse } from "next/server"

const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.iopn.tech"
const CHAIN_ID = 984

// Minimal ERC-20 ABI for transfer
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json()
    const { to, amount, tokenAddress, privateKey } = body

    // Validate required fields
    if (!to || !amount || !tokenAddress || !privateKey) {
      return NextResponse.json(
        { error: "Missing required fields: to, amount, tokenAddress, privateKey" },
        { status: 400 }
      )
    }

    // Validate 'to' is a valid Ethereum address
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid recipient address format" }, { status: 400 })
    }

    // Validate 'tokenAddress' is a valid Ethereum address
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return NextResponse.json({ error: "Invalid token address format" }, { status: 400 })
    }

    // Validate 'privateKey' format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return NextResponse.json({ error: "Invalid private key format" }, { status: 400 })
    }

    // Validate amount is a positive number
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 })
    }

    // Create provider and wallet
    const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID)
    
    // Get wallet address from privateKey (without connecting to provider yet)
    const tempWallet = new Wallet(privateKey)
    const senderAddress = tempWallet.address
    
    // ALWAYS read fresh nonce from chain (pending includes mempool txs)
    const nonce = await provider.getTransactionCount(senderAddress, "pending")
    
    // Now create wallet connected to provider for contract calls
    const wallet = new Wallet(privateKey, provider)

    // Create ERC-20 contract instance for reading
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, wallet)

    // Get token decimals (default to 18 if call fails)
    let decimals = 18
    try {
      decimals = await tokenContract.decimals()
    } catch {
      console.warn("Failed to fetch decimals, defaulting to 18")
    }

    // Convert amount to token units
    let amountInUnits
    try {
      amountInUnits = parseUnits(amount, decimals)
    } catch {
      return NextResponse.json({ error: "Invalid amount format" }, { status: 400 })
    }

    // Check sender balance
    const balance = await tokenContract.balanceOf(senderAddress)
    if (balance < amountInUnits) {
      const balanceFormatted = formatUnits(balance, decimals)
      return NextResponse.json(
        { error: `Insufficient token balance. Available: ${balanceFormatted}, Required: ${amount}` },
        { status: 400 }
      )
    }

    // Send transfer transaction with explicit fresh nonce
    const tx = await tokenContract.transfer(to, amountInUnits, { nonce })

    // Wait for 1 confirmation
    const receipt = await tx.wait(1)

    // Return success response
    return NextResponse.json({
      txHash: tx.hash,
      from: senderAddress,
      to,
      tokenAddress,
      amount,
      status: receipt?.status === 1 ? "confirmed" : "pending",
    })
  } catch (error) {
    console.error("ERC-20 transfer error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// Only allow POST requests
export async function GET() {
  return NextResponse.json({ error: "Method not allowed. Use POST." }, { status: 405 })
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed. Use POST." }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed. Use POST." }, { status: 405 })
}

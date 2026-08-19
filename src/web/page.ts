const STYLES = `
  :root {
    --paper: #f3f1ea;
    --ink: #151612;
    --muted: #6b6b63;
    --line: #d5d2c7;
    --signal: #d75b31;
    --ok: #24684c;
    --display: "Iowan Old Style", Baskerville, Georgia, serif;
    --sans: "Avenir Next", "Helvetica Neue", sans-serif;
    --mono: "SFMono-Regular", "Cascadia Mono", Consolas, monospace;
  }

  * { box-sizing: border-box; }
  html { color-scheme: light; }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    background: var(--paper);
    font-family: var(--sans);
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }

  .shell { width: min(1060px, calc(100% - 40px)); margin: 0 auto; padding: 42px 0 60px; }
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  h1 {
    margin: 0;
    font-family: var(--display);
    font-size: clamp(40px, 6vw, 68px);
    font-weight: 400;
    line-height: .95;
    letter-spacing: -.035em;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 9px;
    padding-bottom: 4px;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .live-dot.stale { background: var(--signal); }

  .trace { border-top: 1px solid var(--ink); }
  .checkpoint {
    display: grid;
    grid-template-columns: 54px 112px minmax(190px, 1fr) minmax(160px, .8fr) 164px;
    gap: 16px;
    min-height: 76px;
    align-items: center;
    border-bottom: 1px solid var(--line);
  }
  .checkpoint[data-state="pending"] { color: #98958b; }
  .checkpoint[data-state="active"] { background: rgba(215,91,49,.045); }
  .ordinal { display: flex; align-items: center; gap: 11px; font-family: var(--mono); font-size: 10px; }
  .mark { width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 50%; flex: none; }
  .checkpoint[data-state="done"] .mark { border-color: var(--ok); background: var(--ok); }
  .checkpoint[data-state="active"] .mark { border: 2px solid var(--signal); animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 50% { transform: scale(1.45); opacity: .45; } }
  .network {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  .checkpoint-title { font-family: var(--display); font-size: 21px; }
  .checkpoint-detail {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .tx-link {
    color: inherit;
    font-family: var(--mono);
    font-size: 10px;
    text-align: right;
    text-transform: uppercase;
    text-underline-offset: 3px;
  }
  .tx-link.empty { color: var(--line); text-decoration: none; }
  .checkpoint-controls { display: flex; justify-content: flex-end; align-items: center; gap: 11px; }
  .action-button, .dialog-button {
    appearance: none;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: .05em;
    line-height: 1;
    text-transform: uppercase;
  }
  .action-button { min-height: 31px; padding: 0 11px; white-space: nowrap; }
  .action-button:hover { background: var(--signal); border-color: var(--signal); }
  .action-button:focus-visible, .dialog-button:focus-visible, .confirm-input:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }
  .bounty-details {
    grid-column: 3 / 6;
    width: 100%;
    margin: -14px 0 18px;
    color: var(--ink);
  }
  .bounty-details summary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    list-style: none;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .bounty-details summary::-webkit-details-marker { display: none; }
  .bounty-details summary::before { content: "+"; color: var(--signal); font-size: 13px; }
  .bounty-details summary::before {
    display: inline-block;
    transform-origin: center;
    transition: transform 180ms ease-out;
  }
  .bounty-details[open] summary::before { transform: rotate(45deg); }
  .bounty-copy {
    max-width: 76ch;
    margin: 12px 0 0;
    padding-left: 20px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.65;
  }
  .bounty-details[open] .bounty-copy {
    animation: bounty-drop 260ms cubic-bezier(.2,.75,.25,1) both;
  }
  @keyframes bounty-drop {
    from { transform: translateY(-8px); }
    to { transform: translateY(0); }
  }
  .warning { margin: 15px 0 0; color: var(--signal); font-family: var(--mono); font-size: 10px; }
  .warning:empty { display: none; }

  dialog {
    width: min(590px, calc(100% - 28px));
    padding: 0;
    border: 1px solid var(--ink);
    color: var(--ink);
    background: var(--paper);
    box-shadow: 12px 12px 0 rgba(21,22,18,.16);
  }
  dialog::backdrop { background: rgba(21,22,18,.48); }
  .dialog-body { padding: 24px; }
  .dialog-kicker { color: var(--signal); font-family: var(--mono); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
  .dialog-title { margin: 8px 0 10px; font-family: var(--display); font-size: 32px; font-weight: 400; }
  .dialog-detail { margin: 0 0 22px; color: var(--muted); font-size: 12.5px; }
  .confirmation-label { display: block; margin-bottom: 8px; color: var(--muted); font-family: var(--mono); font-size: 10px; text-transform: uppercase; }
  .confirmation-phrase { display: block; padding: 12px; border: 1px solid var(--line); font-family: var(--mono); font-size: 11px; overflow-wrap: anywhere; }
  .confirm-input {
    width: 100%;
    margin-top: 10px;
    padding: 12px;
    border: 1px solid var(--ink);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font-family: var(--mono);
    font-size: 11px;
  }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  .dialog-button { min-height: 35px; padding: 0 15px; }
  .dialog-button.secondary { background: transparent; color: var(--ink); }
  .dialog-button:disabled { opacity: .32; cursor: not-allowed; }
  .action-output {
    max-height: 240px;
    margin: 18px 0 0;
    padding: 12px;
    overflow: auto;
    border: 1px solid var(--line);
    background: #ebe8de;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .action-output[hidden] { display: none; }

  @media (max-width: 720px) {
    .shell { width: min(100% - 24px, 1060px); padding-top: 24px; }
    .head { align-items: flex-start; }
    .checkpoint {
      grid-template-columns: 44px 82px minmax(0, 1fr) 40px;
      gap: 9px;
      padding: 13px 0;
    }
    .checkpoint-detail { grid-column: 3 / 5; }
    .bounty-details { grid-column: 3 / 5; margin-top: -3px; }
    .checkpoint.has-action .checkpoint-controls { grid-column: 3 / 5; justify-content: flex-start; padding-bottom: 8px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mark, .bounty-copy { animation: none !important; }
    .bounty-details summary::before { transition: none; }
  }
`;

const BODY = `
<main class="shell">
  <header class="head">
    <h1>Checkpoints</h1>
    <div class="live"><span class="live-dot" id="liveDot"></span><span id="liveText">reading state</span></div>
  </header>
  <div class="trace" id="trace" aria-live="polite"></div>
  <p class="warning" id="warnings"></p>
</main>
<dialog id="actionDialog" aria-labelledby="actionTitle">
  <div class="dialog-body">
    <div class="dialog-kicker">Exact confirmation required</div>
    <h2 class="dialog-title" id="actionTitle">Run action</h2>
    <p class="dialog-detail" id="actionDetail"></p>
    <label class="confirmation-label" for="confirmationInput">Type exactly</label>
    <code class="confirmation-phrase" id="confirmationPhrase"></code>
    <input class="confirm-input" id="confirmationInput" autocomplete="off" autocapitalize="off" spellcheck="false">
    <pre class="action-output" id="actionOutput" hidden></pre>
    <div class="dialog-actions">
      <button class="dialog-button secondary" id="cancelAction" type="button">Cancel</button>
      <button class="dialog-button" id="runAction" type="button" disabled>Run action</button>
    </div>
  </div>
</dialog>
`;

const SCRIPT = String.raw`
  const $ = (id) => document.getElementById(id);
  const BASESCAN = "https://basescan.org";
  const STARKSCAN = "https://starkscan.co";
  let lastStepsSignature = "";
  let actionToken = "";
  let selectedAction = null;
  let actionRunning = false;

  function explorerLink(step) {
    if (!step.txHash || !step.explorer) return null;
    return (step.explorer === "starknet" ? STARKSCAN : BASESCAN) + "/tx/" + step.txHash;
  }

  function render(data) {
    const steps = data.steps || [];
    const actions = data.actions || [];
    const actionByStep = new Map(actions.map((action) => [action.step, action]));
    actionToken = data.actionToken || actionToken;
    const done = steps.filter((step) => step.state === "done").length;
    const trace = $("trace");
    const signature = JSON.stringify({ steps, actions });

    // Polling must not collapse a disclosure the operator opened. Leave an
    // unchanged trace alone; if live state did change, carry open rows across
    // the rebuild by checkpoint number.
    if (signature !== lastStepsSignature) {
      const openRows = new Set(
        [...trace.querySelectorAll(".bounty-details[open]")]
          .map((details) => details.closest(".checkpoint")?.dataset.step)
          .filter(Boolean),
      );
      trace.innerHTML = "";

      steps.forEach((step) => {
      const row = document.createElement("div");
      row.className = "checkpoint";
      row.dataset.state = step.state;
      row.dataset.step = String(step.n);
      const action = actionByStep.get(step.n);
      if (action) row.classList.add("has-action");

      const ordinal = document.createElement("div");
      ordinal.className = "ordinal";
      const mark = document.createElement("span");
      mark.className = "mark";
      const number = document.createElement("span");
      number.textContent = String(step.n).padStart(2, "0");
      ordinal.append(mark, number);

      const network = document.createElement("div");
      network.className = "network";
      network.textContent = step.network;

      const title = document.createElement("div");
      title.className = "checkpoint-title";
      title.textContent = step.title;

      const detail = document.createElement("div");
      detail.className = "checkpoint-detail";
      detail.textContent = step.detail === "—" ? "" : step.detail;

      const href = explorerLink(step);
      const controls = document.createElement("div");
      controls.className = "checkpoint-controls";
      const tx = document.createElement(href ? "a" : "span");
      tx.className = "tx-link" + (href ? "" : " empty");
      tx.textContent = href ? "view" : "—";
      if (href) {
        tx.href = href;
        tx.target = "_blank";
        tx.rel = "noreferrer";
        tx.title = step.txHash;
      }
      controls.append(tx);
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-button";
        button.textContent = action.label;
        button.addEventListener("click", () => openAction(action));
        controls.append(button);
      }

      row.append(ordinal, network, title, detail, controls);
      if (step.content) {
        const disclosure = document.createElement("details");
        disclosure.className = "bounty-details";
        disclosure.open = openRows.has(String(step.n));
        const summary = document.createElement("summary");
        summary.textContent = "View bounty";
        const copy = document.createElement("p");
        copy.className = "bounty-copy";
        copy.textContent = step.content;
        disclosure.append(summary, copy);
        row.append(disclosure);
      }
      trace.append(row);
      });
      lastStepsSignature = signature;
    }

    $("warnings").textContent = (data.warnings || []).join(" · ");
    $("liveDot").className = "live-dot";
    $("liveText").textContent = done + "/" + steps.length + " · live";
  }

  async function poll() {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      render(await response.json());
    } catch (error) {
      $("liveDot").className = "live-dot stale";
      $("liveText").textContent = "state unavailable";
      $("warnings").textContent = error.message || String(error);
    }
  }

  function openAction(action) {
    selectedAction = action;
    $("actionTitle").textContent = action.label;
    $("actionDetail").textContent = action.detail;
    $("confirmationPhrase").textContent = action.confirmation;
    $("confirmationInput").value = "";
    $("actionOutput").textContent = "";
    $("actionOutput").hidden = true;
    $("runAction").textContent = "Run action";
    $("runAction").disabled = true;
    $("cancelAction").textContent = "Cancel";
    $("actionDialog").showModal();
    $("confirmationInput").focus();
  }

  $("confirmationInput").addEventListener("input", () => {
    $("runAction").disabled =
      actionRunning || !selectedAction || $("confirmationInput").value !== selectedAction.confirmation;
  });

  $("cancelAction").addEventListener("click", () => {
    if (!actionRunning) $("actionDialog").close();
  });

  $("actionDialog").addEventListener("cancel", (event) => {
    if (actionRunning) event.preventDefault();
  });

  $("runAction").addEventListener("click", async () => {
    if (!selectedAction || $("confirmationInput").value !== selectedAction.confirmation) return;
    actionRunning = true;
    $("runAction").disabled = true;
    $("cancelAction").disabled = true;
    $("runAction").textContent = "Running…";
    $("actionOutput").hidden = false;
    $("actionOutput").textContent = "Running the guarded local command. Keep this page open…";

    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: actionToken,
          action: selectedAction.id,
          confirmation: $("confirmationInput").value,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Action failed.");
      $("actionOutput").textContent = result.output || "Action completed.";
      $("runAction").textContent = "Completed";
      $("cancelAction").textContent = "Close";
      await poll();
    } catch (error) {
      $("actionOutput").textContent = error.message || String(error);
      $("runAction").textContent = "Failed";
      $("cancelAction").textContent = "Close";
      await poll();
    } finally {
      actionRunning = false;
      $("cancelAction").disabled = false;
    }
  });

  void poll();
  setInterval(poll, 5000);
`;

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>TaskMarket × STRK20 — checkpoints</title>
<style>${STYLES}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body>
</html>`;
}

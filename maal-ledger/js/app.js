let STATE = { view: "dashboard", activeClient: null, activeInvestor: null, filter: "all", search: "" };

// ---- Helpers ----
function money(n) { return "Rs " + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
function dateFmt(d) { if (!d) return "—"; return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function daysUntil(d) { if (!d) return 999; const a = new Date(); a.setHours(0, 0, 0, 0); return Math.round((new Date(d + "T00:00:00") - a) / 86400000); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function toast(s) { const t = document.getElementById("toast"); if (!t) return; t.textContent = s; t.classList.add("show"); clearTimeout(window._toast); window._toast = setTimeout(() => t.classList.remove("show"), 2200); }

function investor(id) { return DB.investors.find(x => x.id === id); }
function client(id) { return DB.clients.find(x => x.id === id); }
function deal(id) { return DB.deals.find(x => x.id === id); }
function dealQists(dealId) { return DB.qists.filter(q => q.dealId === dealId).sort((a, b) => (a.expectedDate || "").localeCompare(b.expectedDate || "")); }
function dealReceived(dealId) { return dealQists(dealId).reduce((s, q) => s + Number(q.receivedAmount || 0), 0); }
function dealOutstanding(dealId) { const d = deal(dealId); return Math.max(0, Number(d.total || 0) - dealReceived(dealId)); }
function qistStatusLabel(q) { return { pending: "Pending", partial: "Partial", paid: "Paid" }[q.status] || "Pending"; }

// Profit is recognized proportionally as cash comes in against a deal's total.
function dealRealizedProfit(d) {
  const total = Number(d.total) || 0, munafa = Number(d.munafa) || 0;
  if (!total) return 0;
  const ratio = Math.min(1, dealReceived(d.id) / total);
  return munafa * ratio;
}

function investorPayouts(id) { return DB.payouts.filter(p => p.investorId === id).sort((a, b) => (b.date || "").localeCompare(a.date || "")); }
function investorWithdrawn(id) { return investorPayouts(id).reduce((s, p) => s + Number(p.amount || 0), 0); }
function investorRealizedProfit(id) { return DB.deals.filter(d => d.investorId === id).reduce((s, d) => s + dealRealizedProfit(d), 0); }
function investorOwed(id) { return investorRealizedProfit(id) - investorWithdrawn(id); }

// ============================================================
// WhatsApp reminders
// ============================================================
const WA_STRINGS = {
  en: {
    greet: name => name ? `Hi ${name},` : "Hi,",
    body: (amt, date) => `your installment of ${amt} is due on ${date}. Kindly confirm once paid.`,
    thanks: "Thank you!"
  },
  ur: {
    // Best-effort Urdu phrasing — have a native speaker sanity-check the wording before relying on it for client-facing messages.
    greet: name => name ? `السلام علیکم ${name}،` : "السلام علیکم،",
    body: (amt, date) => `آپ کی قسط ${amt} کی ادائیگی کی تاریخ ${date} ہے۔ برائے مہربانی ادائیگی کے بعد تصدیق کریں۔`,
    thanks: "شکریہ۔"
  }
};

// generateWhatsAppLink(clientPhone, amount, dueDate, language)
// Builds a personalized reminder (looks up the client by phone in DB.clients
// for the name), opens wa.me with the text pre-filled, and returns the URL.
function generateWhatsAppLink(clientPhone, amount, dueDate, language = "en") {
  const lang = WA_STRINGS[language] ? language : "en";
  const s = WA_STRINGS[lang];
  const phoneDigits = String(clientPhone || "").replace(/\D/g, "");
  const c = (DB.clients || []).find(x => (x.phone || "").replace(/\D/g, "") === phoneDigits);
  const msg = `${s.greet(c?.name)} ${s.body(money(amount), dateFmt(dueDate))} ${s.thanks}`;
  const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
  return url;
}

// Convenience wrapper used by the qist card's WhatsApp button
function sendWhatsAppReminder(qistId) {
  const q = DB.qists.find(x => x.id === qistId);
  if (!q) return;
  const d = deal(q.dealId), c = d ? client(d.clientId) : null;
  if (!c || !c.phone) return alert("This client has no WhatsApp number on file.");
  const remaining = Math.max(0, Number(q.amount) - Number(q.receivedAmount || 0));
  generateWhatsAppLink(c.phone, remaining, q.expectedDate, LANG);
}

// ============================================================
// Bilingual toggle (English / Urdu)
// A minimal dictionary + state manager. Currently wired into the
// sidebar nav and the Dashboard view — extend the I18N object and
// swap literals for t('key') in the other views the same way.
// ============================================================
const I18N = {
  en: {
    nav_dashboard: "Dashboard", nav_clients: "Clients", nav_all: "All Qists", nav_investors: "Investors", nav_cashbook: "Cashbook",
    dash_title: "Dashboard", dash_sub: "Live overview of the ledger",
    cash_on_hand: "Cash on hand", outstanding_debt: "Outstanding debt", realized_profit: "Realized profit",
    overdue_qists: "Overdue qists", due_soon: "Due within 7 days",
    overdue: "Overdue", due_soon_section: "Due soon", view_all: "View all",
    no_overdue: "No overdue qists 🎉", no_due_soon: "Nothing due in the next 7 days.",
    add_client: "+ Client", add_deal: "+ Deal", refresh: "↻ Refresh",
    still_outstanding: "still outstanding."
  },
  ur: {
    nav_dashboard: "ڈیش بورڈ", nav_clients: "کلائنٹس", nav_all: "تمام اقساط", nav_investors: "سرمایہ کار", nav_cashbook: "کیش بک",
    dash_title: "ڈیش بورڈ", dash_sub: "لیجر کا لائیو جائزہ",
    cash_on_hand: "دستیاب نقدی", outstanding_debt: "باقی رقم", realized_profit: "حاصل شدہ منافع",
    overdue_qists: "زائد المیعاد اقساط", due_soon: "اگلے 7 دن میں واجب الادا",
    overdue: "زائد المیعاد", due_soon_section: "جلد واجب الادا", view_all: "سب دیکھیں",
    no_overdue: "کوئی زائد المیعاد قسط نہیں 🎉", no_due_soon: "اگلے 7 دنوں میں کچھ واجب الادا نہیں۔",
    add_client: "+ کلائنٹ", add_deal: "+ ڈیل", refresh: "↻ ریفریش",
    still_outstanding: "ابھی باقی ہے۔"
  }
};

let LANG = localStorage.getItem("maal_lang") || "en";

function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key; }

function applyNavLanguage() {
  document.querySelectorAll(".nav button").forEach(b => {
    const key = { dashboard: "nav_dashboard", clients: "nav_clients", all: "nav_all", investors: "nav_investors", cashbook: "nav_cashbook" }[b.dataset.view];
    if (key) b.textContent = t(key);
  });
  const lt = document.getElementById("langToggle");
  if (lt) lt.textContent = LANG === "en" ? "اردو" : "English";
}

function setLanguage(lang) {
  LANG = I18N[lang] ? lang : "en";
  localStorage.setItem("maal_lang", LANG);
  document.documentElement.setAttribute("lang", LANG);
  document.documentElement.setAttribute("dir", LANG === "ur" ? "rtl" : "ltr");
  applyNavLanguage();
  render();
}

function toggleLanguage() { setLanguage(LANG === "en" ? "ur" : "en"); }

// ============================================================
// Theme toggle (dark / light via localStorage)
// ============================================================
const THEME_KEY = "maal_theme";

function loadTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  localStorage.setItem(THEME_KEY, theme);
  const tt = document.getElementById("themeToggle");
  if (tt) tt.textContent = theme === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

// ============================================================
// Auth gate — RLS requires a session, so nothing loads without one
// ============================================================
async function initAuthGate() {
  loadTheme();
  document.documentElement.setAttribute("lang", LANG);
  document.documentElement.setAttribute("dir", LANG === "ur" ? "rtl" : "ltr");
  let session;
  try { session = await dbGetSession(); } catch (e) { session = null; }
  if (session) { startApp(); return; }
  renderLoginGate();
}

function renderLoginGate() {
  document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;background:var(--page)">
    <div class="card" style="padding:28px;width:100%;max-width:360px">
      <h2 style="margin:0 0 4px">Maal Ledger</h2>
      <p class="muted small" style="margin:0 0 20px">Sign in to access the cloud ledger.</p>
      <div class="field" style="margin-bottom:12px"><label>Email</label><input id="loginEmail" type="email"></div>
      <div class="field" style="margin-bottom:16px"><label>Password</label><input id="loginPass" type="password"></div>
      <div id="loginErr" class="small" style="color:var(--red);margin-bottom:10px;display:none"></div>
      <button class="btn primary" style="width:100%" onclick="doLogin()">Sign in</button>
    </div>
    <div class="toast" id="toast"></div>
  </div>`;
  document.getElementById("loginPass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const errBox = document.getElementById("loginErr");
  errBox.style.display = "none";
  try {
    await dbSignIn(email, pass);
    location.reload();
  } catch (err) {
    errBox.textContent = err.message || "Sign in failed.";
    errBox.style.display = "block";
  }
}

async function startApp() {
  applyNavLanguage();
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");
  
  // 1. Instantly load the dashboard from the browser's memory
  const cached = localStorage.getItem("maal_cache");
  if (cached) {
    DB = JSON.parse(cached);
    render(); 
  }
  
  // 2. Silently fetch any fresh updates in the background without freezing the screen
  await loadDataFromSupabase();
  render();
}

// ============================================================
// Shell / navigation
// ============================================================
function renderSidebar() {
  const q = STATE.search.toLowerCase();
  const cs = DB.clients.filter(c => (c.name || "").toLowerCase().includes(q));
  const list = document.getElementById("custList");
  if (!list) return;
  list.innerHTML = cs.map(c => {
    const ds = DB.deals.filter(d => d.clientId === c.id);
    const total = ds.reduce((s, d) => s + Number(d.total || 0), 0);
    const out = ds.reduce((s, d) => s + dealOutstanding(d.id), 0);
    const pct = total ? Math.round((total - out) / total * 100) : 0;
    const active = STATE.activeClient === c.id && STATE.view === "clients";
    return `<div class="cust-item ${active ? "active" : ""}" onclick="selectClient('${c.id}')">
      <div class="avatar" style="background:#0F766E">${(c.name || "").slice(0, 2).toUpperCase()}</div>
      <div class="cust-info"><div class="cust-name">${esc(c.name)}</div><div class="cust-meta">${pct}% paid · ${money(out)} out</div><div class="mini"><i style="width:${pct}%"></i></div></div>
    </div>`;
  }).join("") || `<div style="padding:15px;color:#98a2b5;font-size:12px">No clients found.</div>`;
}

function layout(title, sub, body, actions = "") {
  return `<div class="topbar"><div class="title"><h2>${title}</h2><p>${sub}</p></div><div class="actions"><button class="btn mobile-menu" onclick="mobileNav()">☰ Menu</button>${actions}</div></div>${body}`;
}

function navActive() {
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.view === STATE.view));
}

function render() {
  navActive();
  renderSidebar();
  let body = "";
  if (STATE.view === "dashboard") body = dashboard();
  else if (STATE.view === "clients") body = clientsView();
  else if (STATE.view === "all") body = allQistsView();
  else if (STATE.view === "investors") body = investorsView();
  else if (STATE.view === "cashbook") body = cashbookView();
  document.getElementById("main").innerHTML = body;
}

// ============================================================
// Dashboard
// ============================================================
function dashboard() {
  const outstanding = DB.deals.reduce((s, d) => s + dealOutstanding(d.id), 0);
  const realizedProfit = DB.deals.reduce((s, d) => s + dealRealizedProfit(d), 0);
  const cashIn = DB.cashbook.filter(e => e.type === "cash_in").reduce((s, e) => s + Number(e.amount), 0);
  const cashOut = DB.cashbook.filter(e => e.type === "cash_out").reduce((s, e) => s + Number(e.amount), 0);
  const overdue = DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) < 0);
  const soon = DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) >= 0 && daysUntil(q.expectedDate) <= 7);

  return layout(t("dash_title"), t("dash_sub"),
    `<div class="stats">
      <div class="card stat"><label>${t("cash_on_hand")}</label><strong class="${cashIn - cashOut >= 0 ? "green" : "red"}">${money(cashIn - cashOut)}</strong></div>
      <div class="card stat"><label>${t("outstanding_debt")}</label><strong class="amber">${money(outstanding)}</strong></div>
      <div class="card stat"><label>${t("realized_profit")}</label><strong class="green">${money(realizedProfit)}</strong></div>
      <div class="card stat"><label>${t("overdue_qists")}</label><strong class="red">${overdue.length}</strong></div>
      <div class="card stat"><label>${t("due_soon")}</label><strong>${soon.length}</strong></div>
    </div>
    ${overdue.length ? `<div class="alert"><b>${overdue.length} ${t("overdue_qists").toLowerCase()}</b> · ${money(overdue.reduce((s, q) => s + Number(q.amount) - Number(q.receivedAmount || 0), 0))} ${t("still_outstanding")}</div>` : ""}
    <div class="section"><div class="section-head"><h3>${t("overdue")}</h3><button class="btn small" onclick="setFilter('overdue')">${t("view_all")}</button></div><div class="qgrid">${overdue.slice(0, 8).map(qbox).join("") || `<div class="empty">${t("no_overdue")}</div>`}</div></div>
    <div class="section"><div class="section-head"><h3>${t("due_soon_section")}</h3><button class="btn small" onclick="setFilter('soon')">${t("view_all")}</button></div><div class="qgrid">${soon.slice(0, 8).map(qbox).join("") || `<div class="empty">${t("no_due_soon")}</div>`}</div></div>`,
    `<button class="btn primary" onclick="openClient()">${t("add_client")}</button><button class="btn" onclick="openDeal()">${t("add_deal")}</button><button class="btn" onclick="syncCloud()">${t("refresh")}</button>`);
}

function qbox(q) {
  const d = deal(q.dealId), c = d ? client(d.clientId) : null;
  const remaining = Number(q.amount) - Number(q.receivedAmount || 0);
  const cls = q.status === "paid" ? "paid" : daysUntil(q.expectedDate) < 0 ? "overdue" : daysUntil(q.expectedDate) <= 7 ? "soon" : "";
  return `<div class="qbox ${cls}">
    ${q.status === "paid" ? '<div class="stamp">PAID</div>' : ''}
    <div class="qnum">${c ? esc(c.name) : ""}</div>
    <div class="qamt">${money(q.amount)}</div>
    <div class="qdate">${dateFmt(q.expectedDate)}</div>
    <div class="status">${qistStatusLabel(q)}${q.receivedAmount > 0 && q.status !== "paid" ? ` · ${money(q.receivedAmount)} in` : ""}</div>
    <div class="qactions"><button class="btn small" onclick="openPayment('${q.id}')">${q.status === "paid" ? "View" : "Pay"}</button><button class="btn small" onclick="openQist('${q.id}')">Edit</button></div>
    ${q.status !== "paid" && c?.phone ? `<button class="btn small" style="width:100%;margin-top:5px" onclick="sendWhatsAppReminder('${q.id}')">WhatsApp</button>` : ""}
  </div>`;
}

// ============================================================
// Clients
// ============================================================
function clientsView() {
  if (!STATE.activeClient) {
    return layout("Clients", `${DB.clients.length} clients in your ledger`,
      `<div class="grid">${DB.clients.map(c => {
        const ds = DB.deals.filter(d => d.clientId === c.id);
        const total = ds.reduce((s, d) => s + Number(d.total || 0), 0);
        const out = ds.reduce((s, d) => s + dealOutstanding(d.id), 0);
        const pct = total ? Math.round((total - out) / total * 100) : 0;
        return `<div class="card customer-card" onclick="selectClient('${c.id}')"><div class="row"><div><b>${esc(c.name)}</b><div class="small muted">${c.phone || "No phone"} · ${ds.length} deal${ds.length === 1 ? "" : "s"}</div></div></div><div class="row" style="margin-top:14px"><span class="small muted">${pct}% paid</span><b>${money(out)}</b></div><div class="progress"><i style="width:${pct}%"></i></div><div class="actions" style="margin-top:12px"><button class="btn small" onclick="event.stopPropagation();openClient('${c.id}')">Edit</button><button class="btn small danger" onclick="event.stopPropagation();deleteClient('${c.id}')">Delete</button></div></div>`;
      }).join("") || '<div class="empty">No clients yet.</div>'}</div>`,
      `<button class="btn primary" onclick="openClient()">+ Add client</button>`);
  }

  const c = client(STATE.activeClient), ds = DB.deals.filter(d => d.clientId === c.id);
  const total = ds.reduce((s, d) => s + Number(d.total || 0), 0), out = ds.reduce((s, d) => s + dealOutstanding(d.id), 0), got = total - out;
  return layout("Client", "All deals and qists for this client",
    `<div class="card header-card"><div class="row"><div><h2>${esc(c.name)}</h2><div class="small muted">${c.phone || "No phone"}</div></div><div class="actions"><button class="btn" onclick="openClient('${c.id}')">Edit client</button><button class="btn primary" onclick="openDeal('${c.id}')">+ Add deal</button></div></div><div class="metrics"><div class="metric"><label>Total tracked</label><strong>${money(total)}</strong></div><div class="metric"><label>Received</label><strong class="green">${money(got)}</strong></div><div class="metric"><label>Outstanding</label><strong class="amber">${money(out)}</strong></div></div><div class="progress"><i style="width:${total ? Math.round(got / total * 100) : 0}%"></i></div></div>
    ${ds.map(d => { const v = investor(d.investorId); return `<div class="card truck"><div class="truck-head"><div><div class="truck-title">${esc(d.itemDetails || "Deal")}</div><div class="truck-sub">Investor: ${v ? esc(v.name) : "—"} · Kharid ${money(d.kharid)} + Munafa ${money(d.munafa)} = ${money(d.total)}</div></div><div class="actions"><button class="btn small" onclick="openDeal('${c.id}','${d.id}')">Edit deal</button><button class="btn small danger" onclick="deleteDeal('${d.id}')">Delete</button></div></div><div class="route">${dealQists(d.id).map(qbox).join("")}</div></div>`; }).join("") || '<div class="empty">No deals for this client.</div>'}`,
    `<button class="btn" onclick="setView('clients')">← Clients</button>`);
}

// ============================================================
// All Qists
// ============================================================
function allQistsView() {
  let xs = DB.qists.slice();
  const filterFn = q => {
    if (STATE.filter === "all") return true;
    if (STATE.filter === "overdue") return q.status !== "paid" && daysUntil(q.expectedDate) < 0;
    if (STATE.filter === "soon") return q.status !== "paid" && daysUntil(q.expectedDate) >= 0 && daysUntil(q.expectedDate) <= 7;
    return q.status === STATE.filter;
  };
  xs = xs.filter(filterFn).sort((a, b) => (a.expectedDate || "").localeCompare(b.expectedDate || ""));
  const counts = {
    all: DB.qists.length,
    overdue: DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) < 0).length,
    soon: DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) >= 0 && daysUntil(q.expectedDate) <= 7).length,
    paid: DB.qists.filter(q => q.status === "paid").length,
    partial: DB.qists.filter(q => q.status === "partial").length
  };
  return layout("All Qists", "Every installment across every deal",
    `<div class="filter">${Object.entries({ all: "All", overdue: "Overdue", soon: "Due soon", partial: "Partial", paid: "Paid" }).map(([k, v]) => `<button class="chip ${STATE.filter === k ? "active" : ""}" onclick="setFilter('${k}')">${v} (${counts[k] || 0})</button>`).join("")}</div><div class="qgrid">${xs.map(qbox).join("") || '<div class="empty">No qists in this filter.</div>'}</div>`, "");
}

// ============================================================
// Investors
// ============================================================
function investorsView() {
  if (!STATE.activeInvestor) {
    return layout("Investors", `${DB.investors.length} investor${DB.investors.length === 1 ? "" : "s"} in the capital pool`,
      `<div class="grid">${DB.investors.map(v => {
        const ds = DB.deals.filter(d => d.investorId === v.id);
        const out = ds.reduce((s, d) => s + dealOutstanding(d.id), 0);
        const owed = investorOwed(v.id);
        return `<div class="card investor-card" onclick="selectInvestor('${v.id}')" style="cursor:pointer"><div class="row"><div><span class="color-dot" style="background:${v.fill}"></span> <b>${esc(v.name)}</b></div><div class="actions"><button class="btn small" onclick="event.stopPropagation();openInvestor('${v.id}')">Edit</button><button class="btn small danger" onclick="event.stopPropagation();deleteInvestor('${v.id}')">Delete</button></div></div>
        <div class="tags" style="margin-top:8px"><span class="tag" style="background:${v.bg};color:${v.textColor}">${v.type === "zero_benefit" ? "Zero-benefit" : "Profit-sharing"}</span></div>
        <div class="row" style="margin-top:12px"><span class="small muted">Deals funded</span><b>${ds.length}</b></div>
        <div class="row"><span class="small muted">Outstanding</span><b class="amber">${money(out)}</b></div>
        ${v.type !== "zero_benefit" ? `<div class="row" style="margin-top:6px;border-top:1px solid var(--line);padding-top:8px"><span class="small muted">Balance owed</span><b class="${owed >= 0 ? "green" : "red"}">${money(owed)}</b></div>` : ""}
        </div>`;
      }).join("") || '<div class="empty">No investors yet.</div>'}</div>`,
      `<button class="btn primary" onclick="openInvestor()">+ Add investor</button>`);
  }

  const v = investor(STATE.activeInvestor);
  const ds = DB.deals.filter(d => d.investorId === v.id);
  const out = ds.reduce((s, d) => s + dealOutstanding(d.id), 0);
  const realized = investorRealizedProfit(v.id), withdrawn = investorWithdrawn(v.id), owed = realized - withdrawn;
  const payouts = investorPayouts(v.id);

  return layout("Investor settlement", "Profit accrued vs. already paid out",
    `<div class="card header-card"><div class="row"><div><h2><span class="color-dot" style="background:${v.fill}"></span> ${esc(v.name)}</h2><div class="tags"><span class="tag" style="background:${v.bg};color:${v.textColor}">${v.type === "zero_benefit" ? "Zero-benefit" : "Profit-sharing"}</span></div></div><div class="actions"><button class="btn" onclick="openInvestor('${v.id}')">Edit investor</button>${v.type !== "zero_benefit" ? `<button class="btn primary" onclick="openPayout('${v.id}')">+ Record payout</button>` : ""}</div></div>
    <div class="metrics">
      <div class="metric"><label>Deals funded</label><strong>${ds.length}</strong></div>
      <div class="metric"><label>Outstanding debt</label><strong class="amber">${money(out)}</strong></div>
      ${v.type !== "zero_benefit" ? `<div class="metric"><label>Realized profit</label><strong class="green">${money(realized)}</strong></div><div class="metric"><label>Already withdrawn</label><strong>${money(withdrawn)}</strong></div><div class="metric"><label>Balance owed</label><strong class="${owed >= 0 ? "green" : "red"}">${money(owed)}</strong></div>` : ""}
    </div></div>
    ${v.type === "zero_benefit" ? `<div class="empty">This investor is zero-benefit — no profit share or payouts apply, funds are tracked for the record only.</div>` : `
    <div class="section"><div class="section-head"><h3>Payout history</h3></div><div class="payment-list">${payouts.map(p => `<div class="payment row"><div><b class="red">− ${money(p.amount)}</b>${p.notes ? `<div class="small muted">${esc(p.notes)}</div>` : ""}</div><div class="row" style="gap:10px"><span class="small muted">${dateFmt(p.date)}</span><button class="btn small danger" onclick="deletePayout('${p.id}')">Delete</button></div></div>`).join("") || '<div class="empty">No payouts recorded yet.</div>'}</div></div>`}
    <div class="section"><div class="section-head"><h3>Deals funded</h3></div><div class="grid">${ds.map(d => { const c = client(d.clientId); return `<div class="card"><div class="row" style="padding:14px 14px 0"><div><b>${esc(c?.name || "")}</b><div class="small muted">${esc(d.itemDetails || "")}</div></div></div><div class="row" style="padding:0 14px 14px"><span class="small muted">Munafa realized</span><b class="green">${money(dealRealizedProfit(d))}</b></div></div>`; }).join("") || '<div class="empty">No deals yet.</div>'}</div></div>`,
    `<button class="btn" onclick="setView('investors')">← Investors</button>`);
}

function selectInvestor(id) { STATE.activeInvestor = id; STATE.view = "investors"; render(); }

function openInvestor(id) {
  const v = id ? investor(id) : { name: "", type: "profit_share", fill: "#0F766E", bg: "#E4F5F1", textColor: "#0B5A54", notes: "" };
  openModal(`<h3>${id ? "Edit investor" : "Add investor"}</h3><div class="form-grid">
  <div class="field"><label>Name *</label><input id="vName" value="${esc(v.name)}"></div>
  <div class="field"><label>Type</label><select id="vType"><option value="profit_share" ${v.type === "profit_share" ? "selected" : ""}>Profit-sharing</option><option value="zero_benefit" ${v.type === "zero_benefit" ? "selected" : ""}>Zero-benefit (just for the record)</option></select></div>
  <div class="field"><label>Color</label><input id="vFill" type="color" value="${v.fill}" style="height:38px;padding:2px"></div>
  <div class="field full"><label>Notes</label><textarea id="vNotes" rows="2">${esc(v.notes || "")}</textarea></div>
  </div><div class="modal-actions">${id ? `<button class="btn danger" onclick="deleteInvestor('${id}')">Delete</button>` : ""}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveInvestor('${id || ""}')">Save</button></div>`);
}

async function saveInvestor(id) {
  const name = document.getElementById("vName").value.trim();
  if (!name) return alert("Investor name is required.");
  const fill = document.getElementById("vFill").value;
  const investorObj = { id: id || uid("inv"), name, type: document.getElementById("vType").value, fill, bg: fill + "22", textColor: fill, notes: document.getElementById("vNotes").value.trim() };
  try { await dbUpsertInvestor(investorObj); closeModal(); render(); toast("Investor saved"); }
  catch (err) { alert("Failed to save investor: " + err.message); }
}

async function deleteInvestor(id) {
  if (DB.deals.some(d => d.investorId === id)) return alert("Can't delete: this investor is linked to existing deals. Reassign those first.");
  if (!confirm("Delete this investor?")) return;
  try { await dbDeleteInvestor(id); closeModal(); render(); toast("Investor deleted"); }
  catch (err) { alert("Delete failed: " + err.message); }
}

function openPayout(investorId) {
  const v = investor(investorId);
  const owed = investorOwed(investorId);
  openModal(`<h3>Record payout — ${esc(v.name)}</h3><p class="small muted">Balance owed before this payout: <b class="${owed >= 0 ? "green" : "red"}">${money(owed)}</b></p><div class="form-grid">
  <div class="field"><label>Amount *</label><input id="poAmt" type="number" value="${owed > 0 ? owed : ""}"></div>
  <div class="field"><label>Date</label><input id="poDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
  <div class="field full"><label>Note</label><input id="poNote" placeholder="Optional"></div>
  </div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="savePayout('${investorId}')">Save payout</button></div>`);
}

async function savePayout(investorId) {
  const amount = Number(document.getElementById("poAmt").value);
  const date = document.getElementById("poDate").value;
  const notes = document.getElementById("poNote").value.trim();
  if (!amount || amount <= 0) return alert("Enter a valid payout amount.");
  try {
    await dbInsertPayout({ id: uid("po"), investorId, amount, date, notes });
    
    closeModal(); render(); toast("Payout recorded");
  } catch (err) { alert("Failed to record payout: " + err.message); }
}

async function deletePayout(id) {
  if (!confirm("Delete this payout record?")) return;
  try { await dbDeletePayout(id);  render(); toast("Payout deleted"); }
  catch (err) { alert("Delete failed: " + err.message); }
}

// ============================================================
// Cashbook
// ============================================================
function cashbookView() {
  const cashIn = DB.cashbook.filter(e => e.type === "cash_in").reduce((s, e) => s + Number(e.amount), 0);
  const cashOut = DB.cashbook.filter(e => e.type === "cash_out").reduce((s, e) => s + Number(e.amount), 0);
  const outstanding = DB.deals.reduce((s, d) => s + dealOutstanding(d.id), 0);
  const realizedProfit = DB.deals.reduce((s, d) => s + dealRealizedProfit(d), 0);
  const entries = DB.cashbook.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || ""));

  return layout("Cashbook", "Chronological ledger of every rupee in and out",
    `<div class="stats">
      <div class="card stat"><label>Total cash in</label><strong class="green">${money(cashIn)}</strong></div>
      <div class="card stat"><label>Total cash out</label><strong class="red">${money(cashOut)}</strong></div>
      <div class="card stat"><label>Cash on hand</label><strong class="${cashIn - cashOut >= 0 ? "green" : "red"}">${money(cashIn - cashOut)}</strong></div>
      <div class="card stat"><label>Outstanding debt</label><strong class="amber">${money(outstanding)}</strong></div>
      <div class="card stat"><label>Realized profit</label><strong class="green">${money(realizedProfit)}</strong></div>
    </div>
    <div class="payment-list">${entries.map(e => {
      const d = e.type === "cash_out" ? deal(e.referenceId) : (deal(DB.qists.find(q => q.id === e.referenceId)?.dealId));
      const label = d ? `${esc(client(d.clientId)?.name || "")} · ${esc(d.itemDetails || "")}` : (e.notes || "");
      return `<div class="payment row"><div><b class="${e.type === "cash_in" ? "green" : "red"}">${e.type === "cash_in" ? "+ " : "− "}${money(e.amount)}</b><div class="small muted">${label}${e.notes && d ? " · " + esc(e.notes) : ""}</div></div><div class="small muted">${dateFmt(e.date)}</div></div>`;
    }).join("") || '<div class="empty">No cashbook entries yet.</div>'}</div>`, "");
}

// ============================================================
// Modals
// ============================================================
function openModal(content) { document.getElementById("modal").innerHTML = content; document.getElementById("modalBack").classList.add("show"); }
function closeModal() { document.getElementById("modalBack").classList.remove("show"); }

function openClient(id) {
  const c = id ? client(id) : { name: "", phone: "", notes: "" };
  openModal(`<h3>${id ? "Edit client" : "Add client"}</h3><div class="form-grid">
  <div class="field"><label>Name *</label><input id="fName" value="${esc(c.name)}"></div>
  <div class="field"><label>Phone</label><input id="fPhone" value="${esc(c.phone || "")}"></div>
  <div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(c.notes || "")}</textarea></div></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveClient('${id || ""}')">Save</button></div>`);
}

async function saveClient(id) {
  const name = document.getElementById("fName").value.trim();
  if (!name) return alert("Client name is required.");
  const clientObj = { id: id || uid("cl"), name, phone: document.getElementById("fPhone").value.trim(), notes: document.getElementById("fNotes").value.trim() };
  try {
    await dbUpsertClient(clientObj); 
    if (!id) STATE.activeClient = clientObj.id;
    closeModal(); render(); toast("Client saved");
  } catch (err) { alert("Failed to save: " + err.message); }
}

async function deleteClient(id) {
  if (!confirm("Delete this client and all their deals/qists permanently?")) return;
  try { await dbDeleteClient(id); STATE.activeClient = null; render(); toast("Client deleted"); }
  catch (err) { alert("Delete failed: " + err.message); }
}

function openDeal(cid, did) {
  if (!DB.investors.length) return alert("Add an investor first before creating a deal.");
  if (!DB.clients.length) return alert("Add a client first before creating a deal.");
  const d = did ? deal(did) : { clientId: cid || DB.clients[0].id, investorId: DB.investors[0].id, itemDetails: "", kharid: "", munafa: "" };
  const qs = did ? dealQists(did) : [];
  openModal(`<h3>${did ? "Edit deal" : "Add deal"}</h3><div class="form-grid">
  <div class="field"><label>Client *</label><select id="dClient">${DB.clients.map(c => `<option value="${c.id}" ${(c.id === (cid || d.clientId)) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
  <div class="field"><label>Investor</label><select id="dInv">${DB.investors.map(v => `<option value="${v.id}" ${d.investorId === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
  <div class="field full"><label>Item details</label><input id="dItems" value="${esc(d.itemDetails)}" placeholder="12 cows, Corolla 2019, etc."></div>
  <div class="field"><label>Kharid (purchase price) *</label><input id="dKharid" type="number" value="${d.kharid}" oninput="updateDealTotal()"></div>
  <div class="field"><label>Munafa (profit) *</label><input id="dMunafa" type="number" value="${d.munafa}" oninput="updateDealTotal()"></div>
  <div class="field full"><label>Total</label><input id="dTotal" value="${money((d.kharid || 0) + (d.munafa || 0))}" disabled></div>
  </div>
  ${did ? `<div class="section"><div class="section-head"><h3>Qists</h3><button class="btn small" onclick="addQistRow()">+ Add qist</button></div><div id="qistRows">${qs.map(qistRowHtml).join("")}</div><p class="small muted">Editing amounts/dates here only affects new qists — use "Edit" on an existing qist card to change it, or "Pay" to record a payment.</p></div>` :
      `<div class="section"><div class="section-head"><h3>Qists</h3><button class="btn small" onclick="addQistRow()">+ Add qist</button></div><div id="qistRows"></div></div>`}
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveDeal('${did || ""}')">Save deal</button></div>`);
}

function updateDealTotal() {
  const k = Number(document.getElementById("dKharid").value) || 0;
  const m = Number(document.getElementById("dMunafa").value) || 0;
  document.getElementById("dTotal").value = money(k + m);
}

function qistRowHtml(q = { amount: "", expectedDate: "" }) {
  const locked = !!q.id;
  return `<div class="form-grid inst-row" style="margin-bottom:8px" data-existing="${locked ? "1" : "0"}">
    <div class="field"><label>Amount</label><input class="qa" type="number" value="${q.amount}" ${locked ? "disabled" : ""}></div>
    <div class="field"><label>Expected date</label><input class="qd" type="date" value="${q.expectedDate || ""}" ${locked ? "disabled" : ""}></div>
    ${locked ? `<div class="field"><label>Status</label><input value="${qistStatusLabel(q)}" disabled></div>` : `<button class="btn small danger" style="align-self:end;height:38px" onclick="this.parentElement.remove()">Remove</button>`}
  </div>`;
}

function addQistRow() {
  document.getElementById("qistRows").insertAdjacentHTML("beforeend", qistRowHtml());
}

async function saveDeal(did) {
  const clientId = document.getElementById("dClient").value;
  const investorId = document.getElementById("dInv").value;
  const itemDetails = document.getElementById("dItems").value.trim();
  const kharid = Number(document.getElementById("dKharid").value) || 0;
  const munafa = Number(document.getElementById("dMunafa").value) || 0;
  if (!clientId || !kharid) return alert("Client and Kharid are required.");

  const newRows = [...document.querySelectorAll('.inst-row[data-existing="0"]')].map(r => ({
    amount: Number(r.querySelector(".qa").value), expectedDate: r.querySelector(".qd").value
  })).filter(x => x.amount && x.expectedDate);

  const dealId = did || uid("d");
  const dealObj = { id: dealId, clientId, investorId, itemDetails, kharid, munafa };

  try {
    await dbUpsertDeal(dealObj, newRows);
    
    STATE.activeClient = clientId;
    closeModal(); render(); toast("Deal saved");
  } catch (err) { alert("Failed saving deal: " + err.message); }
}

async function deleteDeal(id) {
  if (!confirm("Delete this deal and all its qists/cashbook history permanently?")) return;
  try { await dbDeleteDeal(id); render(); toast("Deal deleted"); }
  catch (err) { alert("Delete failed: " + err.message); }
}

function openQist(id) {
  const q = DB.qists.find(x => x.id === id);
  openModal(`<h3>Edit qist</h3><div class="form-grid">
  <div class="field"><label>Amount</label><input id="eqa" type="number" value="${q.amount}"></div>
  <div class="field"><label>Expected date</label><input id="eqd" type="date" value="${q.expectedDate || ""}"></div>
  </div><p class="small muted">Received amount: ${money(q.receivedAmount || 0)} · Status: ${qistStatusLabel(q)}</p>
  <div class="modal-actions"><button class="btn danger" onclick="deleteQist('${id}')">Delete</button><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveQist('${id}')">Save</button></div>`);
}

async function saveQist(id) {
  const amount = Number(document.getElementById("eqa").value);
  const expectedDate = document.getElementById("eqd").value;
  try { await dbUpdateQist({ id, amount, expectedDate }); closeModal(); render(); toast("Qist updated"); }
  catch (err) { alert("Failed update: " + err.message); }
}

async function deleteQist(id) {
  if (!confirm("Delete this qist and its payment history?")) return;
  try { await dbDeleteQist(id); closeModal(); render(); toast("Qist deleted"); }
  catch (err) { alert("Failed delete: " + err.message); }
}

function openPayment(id) {
  const q = id ? DB.qists.find(x => x.id === id) : null;
  const xs = q ? [q] : DB.qists.filter(x => x.status !== "paid");
  const remaining = q ? Number(q.amount) - Number(q.receivedAmount || 0) : "";
  openModal(`<h3>Record payment</h3><div class="form-grid">
  <div class="field full"><label>Qist *</label><select id="pQist">${xs.map(x => { const d = deal(x.dealId), c = client(d?.clientId); return `<option value="${x.id}">${esc(c?.name)} · ${money(x.amount)} · ${dateFmt(x.expectedDate)}</option>`; }).join("")}</select></div>
  <div class="field"><label>Amount received *</label><input id="pAmt" type="number" value="${remaining}"></div>
  <div class="field"><label>Date</label><input id="pDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
  <div class="field full"><label>Note</label><input id="pNote" placeholder="Optional"></div>
  </div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="savePayment()">Save payment</button></div>`);
}

async function savePayment() {
  const id = document.getElementById("pQist").value;
  const amt = Number(document.getElementById("pAmt").value);
  const date = document.getElementById("pDate").value;
  const note = document.getElementById("pNote").value.trim();
  if (!amt || amt <= 0) return alert("Enter a valid payment amount.");
  const q = DB.qists.find(x => x.id === id);
  if (Number(q.receivedAmount || 0) + amt > Number(q.amount) && !confirm("This exceeds the qist amount. Continue?")) return;
  try { await dbRecordQistPayment(id, amt, date, note); closeModal(); render(); toast("Payment recorded"); }
  catch (err) { alert("Failed saving payment: " + err.message); }
}

// ============================================================
// Nav / misc
// ============================================================
function setFilter(f) { STATE.filter = f; STATE.view = "all"; render(); }
function setView(v) { STATE.view = v; STATE.activeClient = null; STATE.activeInvestor = null; render(); }
function selectClient(id) { STATE.activeClient = id; STATE.view = "clients"; render(); }
function mobileNav() { const s = document.querySelector(".sidebar"); if (s) s.style.display = "flex"; }

async function syncCloud() {
  toast("Refreshing from Supabase...");
  await loadDataFromSupabase();
  render();
  toast("Database up to date");
}

document.querySelectorAll(".nav button").forEach(b => b.onclick = () => { STATE.view = b.dataset.view; STATE.activeClient = null; STATE.activeInvestor = null; render(); });
const searchBoxEl = document.getElementById("searchBox");
if (searchBoxEl) searchBoxEl.oninput = e => { STATE.search = e.target.value; renderSidebar(); };
const modalBackEl = document.getElementById("modalBack");
if (modalBackEl) modalBackEl.addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// App init — gated behind auth
initAuthGate();

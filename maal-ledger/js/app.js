let STATE = { view: "dashboard", activeClient: null, activeInvestor: null, filter: "all", search: "", cashFrom: "", cashTo: "", cashClient: "", stmtClient: "", stmtDeal: "", stmtLang: "", stmtShowProfit: false, stmtRemarks: "" };

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
// Cash flow — single source of truth. Dashboard, the Cashbook view,
// and the Cash IN/OUT PDF all read through these same functions so
// there is never a second, drifting calculation of the same numbers.
// ============================================================
function getCashTransactionsByDateRange(fromDate, toDate, clientId) {
  return DB.cashbook.filter(e => {
    if (fromDate && e.date < fromDate) return false;
    if (toDate && e.date > toDate) return false;
    if (clientId) {
      const d = e.type === "cash_out" ? deal(e.referenceId) : deal(DB.qists.find(q => q.id === e.referenceId)?.dealId);
      if (!d || d.clientId !== clientId) return false;
    }
    return true;
  }).sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.id || "").localeCompare(b.id || ""));
}
function calculateCashInTotal(entries) { return entries.filter(e => e.type === "cash_in").reduce((s, e) => s + Number(e.amount), 0); }
function calculateCashOutTotal(entries) { return entries.filter(e => e.type === "cash_out").reduce((s, e) => s + Number(e.amount), 0); }
function calculateNetCashFlow(entries) { return calculateCashInTotal(entries) - calculateCashOutTotal(entries); }
function cashEntryLabel(e) {
  const d = e.type === "cash_out" ? deal(e.referenceId) : deal(DB.qists.find(q => q.id === e.referenceId)?.dealId);
  return { who: d ? client(d.clientId)?.name || "" : "", what: d ? (d.itemDetails || "") : (e.notes || "") };
}

// ============================================================
// Cash IN / Cash OUT PDF (also doubles as the Reports PDF — this
// app has no separate reporting module, Cashbook already is the
// report, so both buttons call this against the same filtered data
// the user is currently looking at).
// Note: jsPDF's built-in fonts don't render Urdu/Nastaliq script,
// so this PDF is always generated in English regardless of the
// UI language toggle — a known limitation, not silently faked.
// ============================================================
function buildCashbookPDF() {
  if (!window.jspdf) { alert("PDF library failed to load — check your internet connection and try again."); return null; }
  const from = STATE.cashFrom || "", to = STATE.cashTo || "", clientId = STATE.cashClient || "";
  const entries = getCashTransactionsByDateRange(from, to, clientId);
  if (!entries.length) { alert("No transactions in this range to export."); return null; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const clientName = clientId ? (client(clientId)?.name || "") : "";

  doc.setFontSize(16); doc.setTextColor(20, 33, 61);
  doc.text("MAAL LEDGER", 14, 16);
  doc.setFontSize(11); doc.setTextColor(60);
  doc.text("Cash IN / Cash OUT Report", 14, 23);
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`Date From: ${from ? dateFmt(from) : "Beginning"}    Date To: ${to ? dateFmt(to) : "Today"}${clientName ? `    Client: ${clientName}` : ""}`, 14, 29);
  doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`, 14, 34);

  const rows = entries.map(e => {
    const { who, what } = cashEntryLabel(e);
    return [
      dateFmt(e.date),
      e.type === "cash_in" ? "Cash IN" : "Cash OUT",
      who,
      what,
      e.type === "cash_in" ? money(e.amount) : "",
      e.type === "cash_out" ? money(e.amount) : "",
      e.notes || ""
    ];
  });

  doc.autoTable({
    startY: 40,
    head: [["Date", "Type", "Client", "Description", "Cash IN", "Cash OUT", "Notes"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [20, 33, 61], textColor: 255 },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" } },
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, doc.internal.pageSize.width - 26, doc.internal.pageSize.height - 10);
    }
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10); doc.setTextColor(20);
  doc.text(`Total Cash IN:`, 14, finalY); doc.text(money(calculateCashInTotal(entries)), 60, finalY);
  doc.text(`Total Cash OUT:`, 14, finalY + 6); doc.text(money(calculateCashOutTotal(entries)), 60, finalY + 6);
  doc.setFont(undefined, "bold");
  doc.text(`Net Cash Flow:`, 14, finalY + 13); doc.text(money(calculateNetCashFlow(entries)), 60, finalY + 13);
  doc.setFont(undefined, "normal");

  doc._filename = `maal-ledger-cashbook-${from || "all"}-to-${to || "today"}.pdf`;
  return doc;
}

function generateCashbookPDF() {
  const doc = buildCashbookPDF();
  if (doc) doc.save(doc._filename);
}

function shareCashbookPDF() {
  const doc = buildCashbookPDF();
  if (doc) sharePDFToWhatsApp(doc, doc._filename, "Maal Ledger — Cash IN/OUT report");
}

// Shares a jsPDF document to WhatsApp (or any other app the person picks)
// via the native OS share sheet, so the actual file — not just a link —
// reaches the recipient. There is no way to pre-target a specific WhatsApp
// contact from a web page for file attachments; the person chooses the
// recipient inside WhatsApp after tapping it in the share sheet. Falls back
// to a plain download on desktop browsers / devices that don't support it.
async function sharePDFToWhatsApp(doc, filename, shareText) {
  try {
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename, text: shareText || "" });
      return;
    }
  } catch (err) {
    if (err.name === "AbortError") return; // person cancelled the share sheet
    console.error("Share failed:", err);
  }
  doc.save(filename);
  alert("This device/browser doesn't support direct sharing to WhatsApp — the PDF has been downloaded instead. Attach it manually from WhatsApp.");
}

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
function buildDefaultWhatsAppMessage(clientPhone, amount, dueDate, language = "en") {
  const lang = WA_STRINGS[language] ? language : "en";
  const s = WA_STRINGS[lang];
  const phoneDigits = String(clientPhone || "").replace(/\D/g, "");
  const c = (DB.clients || []).find(x => (x.phone || "").replace(/\D/g, "") === phoneDigits);
  return `${s.greet(c?.name)} ${s.body(money(amount), dateFmt(dueDate))} ${s.thanks}`;
}

function generateWhatsAppLink(clientPhone, amount, dueDate, language = "en") {
  const msg = buildDefaultWhatsAppMessage(clientPhone, amount, dueDate, language);
  const phoneDigits = String(clientPhone || "").replace(/\D/g, "");
  const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
  return url;
}

// Customize → Preview → Send flow. Opens with the auto-generated default
// message already filled in and editable; nothing is sent until the user
// taps "Send on WhatsApp".
function openWhatsAppComposer(qistId) {
  const q = DB.qists.find(x => x.id === qistId);
  if (!q) return;
  const d = deal(q.dealId), c = d ? client(d.clientId) : null;
  if (!c || !c.phone) return alert("This client has no WhatsApp number on file.");
  const remaining = Math.max(0, Number(q.amount) - Number(q.receivedAmount || 0));
  const defaultMsg = buildDefaultWhatsAppMessage(c.phone, remaining, q.expectedDate, LANG);
  openModal(`<h3>Customize WhatsApp message</h3>
  <p class="small muted">To: ${esc(c.name)} · ${esc(c.phone)}</p>
  <div class="field full" style="margin-bottom:12px"><label>Message</label><textarea id="waMsg" rows="5" oninput="document.getElementById('waPreview').textContent=this.value">${esc(defaultMsg)}</textarea></div>
  <div class="field full"><label>Preview</label><div id="waPreview" class="wa-preview">${esc(defaultMsg)}</div></div>
  <div class="modal-actions" style="justify-content:space-between">
    <button class="btn small" onclick="resetWhatsAppMessage('${qistId}')">Reset to default</button>
    <div style="display:flex;gap:8px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="sendCustomWhatsApp('${esc(c.phone)}')">Send on WhatsApp</button></div>
  </div>`);
}

function resetWhatsAppMessage(qistId) {
  const q = DB.qists.find(x => x.id === qistId);
  const d = deal(q.dealId), c = client(d.clientId);
  const remaining = Math.max(0, Number(q.amount) - Number(q.receivedAmount || 0));
  const msg = buildDefaultWhatsAppMessage(c.phone, remaining, q.expectedDate, LANG);
  document.getElementById("waMsg").value = msg;
  document.getElementById("waPreview").textContent = msg;
}

function sendCustomWhatsApp(clientPhone) {
  const msg = document.getElementById("waMsg").value;
  if (!msg.trim()) return alert("Message can't be empty.");
  const phoneDigits = String(clientPhone || "").replace(/\D/g, "");
  const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
  closeModal();
}

// ============================================================
// Statements — bilingual, remarks-aware, multi-deal-safe statement
// engine shared by the message composer, PDF, and WhatsApp-PDF-share.
// A client's deals are NEVER merged/combined into one installment
// schedule — "All Deals" just renders each deal as its own clearly
// separated section, one after another.
// ============================================================
const STMT_STRINGS = {
  en: {
    greet: name => name ? `Dear ${name},` : "Dear Customer,",
    dealHeader: (n, item) => `Deal ${n} — ${item}`,
    purchaseDate: "Purchase Date",
    qistLine: (n, due, paid, amt, status) => `  Installment ${n}: Due ${due} | Paid: ${paid} | ${amt} (${status})`,
    totalLine: "Total", outstandingLine: "Outstanding",
    breakdownLine: (kharid, munafa, total) => `Purchase: ${kharid} + Profit: ${munafa} = Total: ${total}`,
    remarksLabel: "Remarks", thanks: "Thank you for your business!",
    notPaid: "Not Paid"
  },
  ur: {
    greet: name => name ? `محترم ${name}،` : "محترم گاہک،",
    dealHeader: (n, item) => `ڈیل ${n} — ${item}`,
    purchaseDate: "خریداری کی تاریخ",
    qistLine: (n, due, paid, amt, status) => `  قسط ${n}: تاریخ ${due} | ادائیگی: ${paid} | ${amt} (${status})`,
    totalLine: "کل", outstandingLine: "باقی",
    breakdownLine: (kharid, munafa, total) => `خرید: ${kharid} + منافع: ${munafa} = کل: ${total}`,
    remarksLabel: "تبصرہ", thanks: "آپ کے کاروبار کا شکریہ!",
    notPaid: "ادا نہیں ہوئی"
  }
};

// Clear 3-state status for reports: Paid / Pending / Overdue.
// Partial-payment nuance isn't discarded — it still shows up via the
// separate Received/Payment-Date columns alongside this status.
function qistStatusForReport(q) {
  if (q.status === "paid") return "Paid";
  return daysUntil(q.expectedDate) < 0 ? "Overdue" : "Pending";
}

function buildStatementMessage(dealIds, language, showProfit, remarks) {
  const lang = STMT_STRINGS[language] ? language : "en";
  const s = STMT_STRINGS[lang];
  const deals = dealIds.map(id => deal(id)).filter(Boolean);
  const c = deals.length ? client(deals[0].clientId) : null;
  const lines = [s.greet(c?.name), ""];
  deals.forEach((d, di) => {
    lines.push(s.dealHeader(di + 1, d.itemDetails || "Deal"));
    lines.push(`${s.purchaseDate}: ${dateFmt(d.created)}`);
    dealQists(d.id).forEach((q, i) => {
      const paidDate = Number(q.receivedAmount || 0) > 0 ? dateFmt(q.receivedDate) : s.notPaid;
      lines.push(s.qistLine(i + 1, dateFmt(q.expectedDate), paidDate, money(q.amount), qistStatusForReport(q)));
    });
    lines.push(showProfit ? s.breakdownLine(money(d.kharid), money(d.munafa), money(d.total)) : `${s.totalLine}: ${money(d.total)}`);
    lines.push(`${s.outstandingLine}: ${money(dealOutstanding(d.id))}`, "");
  });
  if (remarks && remarks.trim()) lines.push(`${s.remarksLabel}: ${remarks.trim()}`, "");
  lines.push(s.thanks);
  return lines.join("\n");
}

// Note: like the Cashbook PDF, this is always rendered in English regardless
// of the message-language toggle — jsPDF's built-in fonts can't shape Urdu script.
function buildStatementPDF(dealIds, showProfit, remarks) {
  if (!window.jspdf) { alert("PDF library failed to load — check your internet connection and try again."); return null; }
  const deals = dealIds.map(id => deal(id)).filter(Boolean);
  if (!deals.length) { alert("No deal selected."); return null; }
  const c = client(deals[0].clientId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageH = doc.internal.pageSize.height;

  doc.setFontSize(16); doc.setTextColor(20, 33, 61); doc.text("MAAL LEDGER", 14, 16);
  doc.setFontSize(11); doc.setTextColor(60); doc.text("Deal Statement", 14, 23);
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`Client: ${c?.name || ""}    Generated: ${new Date().toLocaleString("en-GB")}`, 14, 29);
  let y = 38;

  deals.forEach((d, di) => {
    if (y > pageH - 60) { doc.addPage(); y = 20; }
    doc.setFontSize(12); doc.setTextColor(20, 33, 61); doc.setFont(undefined, "bold");
    doc.text(`Deal ${di + 1} — ${d.itemDetails || "Deal"}`, 14, y); y += 6;
    doc.setFont(undefined, "normal"); doc.setFontSize(9); doc.setTextColor(80);
    doc.text(`Purchase Date: ${dateFmt(d.created)}    Investment: ${money(d.total)}`, 14, y); y += 6;

    const rows = dealQists(d.id).map((q, i) => [
      String(i + 1), dateFmt(q.expectedDate),
      Number(q.receivedAmount || 0) > 0 ? dateFmt(q.receivedDate) : "Not Paid",
      money(q.amount), money(q.receivedAmount || 0), qistStatusForReport(q)
    ]);

    doc.autoTable({
      startY: y,
      head: [["#", "Due Date", "Payment Date", "Amount", "Received", "Status"]],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [20, 33, 61], textColor: 255 },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Page ${doc.internal.getNumberOfPages()}`, doc.internal.pageSize.width - 26, pageH - 10);
      }
    });
    y = doc.lastAutoTable.finalY + 6;

    doc.setFontSize(9); doc.setTextColor(20);
    if (showProfit) { doc.text(`Purchase (Kharid): ${money(d.kharid)}   Profit (Munafa): ${money(d.munafa)}`, 14, y); y += 6; }
    doc.setFont(undefined, "bold");
    doc.text(`Total: ${money(d.total)}   Outstanding: ${money(dealOutstanding(d.id))}`, 14, y); y += 10;
    doc.setFont(undefined, "normal");
  });

  if (remarks && remarks.trim()) {
    if (y > pageH - 30) { doc.addPage(); y = 20; }
    doc.setFontSize(10); doc.setTextColor(20); doc.setFont(undefined, "bold");
    doc.text("Remarks:", 14, y); y += 6;
    doc.setFont(undefined, "normal");
    doc.text(doc.splitTextToSize(remarks.trim(), 180), 14, y);
  }

  doc._filename = `statement-${(c?.name || "client").replace(/\s+/g, "-")}${deals.length > 1 ? "-all-deals" : ""}.pdf`;
  return doc;
}

let STMT_DEAL_IDS = [];

function downloadStatementPDF() {
  const doc = buildStatementPDF(STMT_DEAL_IDS, !!STATE.stmtShowProfit, STATE.stmtRemarks || "");
  if (doc) doc.save(doc._filename);
}
function shareStatementPDF() {
  const doc = buildStatementPDF(STMT_DEAL_IDS, !!STATE.stmtShowProfit, STATE.stmtRemarks || "");
  if (doc) sharePDFToWhatsApp(doc, doc._filename, "Maal Ledger — statement");
}
function sendStatementWhatsApp(clientId) {
  const c = client(clientId);
  if (!c?.phone) return alert("This client has no WhatsApp number on file.");
  const msg = document.getElementById("stmtMsg")?.value;
  if (!msg || !msg.trim()) return alert("Message can't be empty.");
  window.open(`https://wa.me/${String(c.phone).replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
}

async function saveDealRemarks(dealId) {
  const remarks = document.getElementById("stmtRemarks")?.value || "";
  try { await dbUpdateDealRemarks(dealId, remarks); toast("Remarks saved to deal"); }
  catch (err) { alert("Failed to save remarks: " + err.message); }
}

// Navigates to the Statements view with a specific client/deal preselected —
// used by "Statement" buttons on deal cards, and by clicking a qist card.
function goToDealStatement(clientId, dealId) {
  STATE.stmtClient = clientId; STATE.stmtDeal = dealId; STATE.stmtRemarks = deal(dealId)?.remarks || "";
  STATE.stmtShowProfit = false;
  STATE.view = "statements"; STATE.activeClient = null; STATE.activeInvestor = null;
  closeMobileNav(); render();
}

function goToQistDeal(qistId) {
  const q = DB.qists.find(x => x.id === qistId);
  if (!q) return;
  const d = deal(q.dealId);
  if (!d) return;
  goToDealStatement(d.clientId, d.id);
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
    nav_dashboard: "Dashboard", nav_clients: "Clients", nav_all: "All Qists", nav_investors: "Investors", nav_cashbook: "Cashbook", nav_statements: "Statements", nav_settings: "Settings",
    dash_title: "Dashboard", dash_sub: "Live overview of the ledger",
    cash_on_hand: "Cash on hand", outstanding_debt: "Outstanding debt", realized_profit: "Realized profit",
    overdue_qists: "Overdue qists", due_soon: "Due within 7 days",
    overdue: "Overdue", due_soon_section: "Due soon", view_all: "View all",
    no_overdue: "No overdue qists 🎉", no_due_soon: "Nothing due in the next 7 days.",
    add_client: "+ Client", add_deal: "+ Deal", refresh: "↻ Refresh",
    still_outstanding: "still outstanding."
  },
  ur: {
    nav_dashboard: "ڈیش بورڈ", nav_clients: "کلائنٹس", nav_all: "تمام اقساط", nav_investors: "سرمایہ کار", nav_cashbook: "کیش بک", nav_statements: "بیانات", nav_settings: "ترتیبات",
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
    const key = { dashboard: "nav_dashboard", clients: "nav_clients", all: "nav_all", investors: "nav_investors", cashbook: "nav_cashbook", statements: "nav_statements", settings: "nav_settings" }[b.dataset.view];
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
let CURRENT_SESSION = null;

async function initAuthGate() {
  loadTheme();
  document.documentElement.setAttribute("lang", LANG);
  document.documentElement.setAttribute("dir", LANG === "ur" ? "rtl" : "ltr");
  let session;
  try { session = await dbGetSession(); } catch (e) { session = null; }
  CURRENT_SESSION = session;
  if (session) { startApp(); return; }
  renderLoginGate();
}

function renderLoginGate() {
  document.body.innerHTML = `<div class="login-wrap">
    <div class="card login-card">
      <h2 style="margin:0 0 4px">Maal Ledger</h2>
      <p class="muted small" style="margin:0 0 20px">Sign in to access the cloud ledger.</p>
      <div class="field" style="margin-bottom:12px"><label>Email</label><input id="loginEmail" type="email" autocomplete="username"></div>
      <div class="field" style="margin-bottom:8px"><label>Password</label>
        <div class="pw-wrap"><input id="loginPass" type="password" autocomplete="current-password"><button type="button" class="pw-toggle" onclick="togglePwVisibility()">Show</button></div>
      </div>
      <div style="text-align:right;margin-bottom:16px"><a href="javascript:void(0)" class="small" onclick="openForgotPassword()">Forgot password?</a></div>
      <div id="loginErr" class="small" style="color:var(--red);margin-bottom:10px;display:none"></div>
      <button class="btn primary" id="loginBtn" style="width:100%" onclick="doLogin()">Sign in</button>
    </div>
    <div class="toast" id="toast"></div>
    <div class="modal-back" id="modalBack"><div class="modal" id="modal"></div></div>
  </div>`;
  document.getElementById("loginPass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });
}

function togglePwVisibility() {
  const inp = document.getElementById("loginPass");
  const btn = document.querySelector(".pw-toggle");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  btn.textContent = show ? "Hide" : "Show";
}

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const errBox = document.getElementById("loginErr");
  const btn = document.getElementById("loginBtn");
  errBox.style.display = "none";
  if (!email || !pass) { errBox.textContent = "Enter both email and password."; errBox.style.display = "block"; return; }
  btn.disabled = true; btn.textContent = "Signing in...";
  try {
    await dbSignIn(email, pass);
    location.reload();
  } catch (err) {
    errBox.textContent = err.message || "Sign in failed.";
    errBox.style.display = "block";
    btn.disabled = false; btn.textContent = "Sign in";
  }
}

function openForgotPassword() {
  openModal(`<h3>Reset password</h3><p class="small muted">Enter your account email — we'll send a password reset link.</p>
  <div class="field full"><label>Email</label><input id="frEmail" type="email"></div>
  <div id="frMsg" class="small" style="margin-top:8px;display:none"></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="frBtn" onclick="sendResetEmail()">Send reset link</button></div>`);
}

async function sendResetEmail() {
  const email = document.getElementById("frEmail").value.trim();
  const msg = document.getElementById("frMsg"), btn = document.getElementById("frBtn");
  if (!email) return alert("Enter your email.");
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const { error } = await dbClient.auth.resetPasswordForEmail(email);
    if (error) throw error;
    msg.style.color = "var(--green)"; msg.textContent = "Reset link sent — check your inbox."; msg.style.display = "block";
  } catch (err) {
    msg.style.color = "var(--red)"; msg.textContent = err.message || "Failed to send reset email."; msg.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Send reset link";
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
function nearlyCompleteDeals(limit = 3) {
  return DB.deals
    .map(d => ({ d, pct: d.total ? Math.round((dealReceived(d.id) / d.total) * 100) : 0 }))
    .filter(x => x.pct > 0 && x.pct < 100)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit);
}

function renderSidebar() {
  const q = STATE.search.toLowerCase();
  const cs = DB.clients.filter(c => (c.name || "").toLowerCase().includes(q));
  const list = document.getElementById("custList");
  const nc = document.getElementById("nearlyComplete");
  if (nc) {
    const top = nearlyCompleteDeals();
    nc.innerHTML = `<div class="nc-wrap"><div class="nc-label">Nearly complete</div>${top.map(x => {
      const c = client(x.d.clientId);
      return `<div class="nc-item" onclick="selectClient('${x.d.clientId}')"><div class="row"><span>${esc(c?.name || "")}</span><span style="font-weight:800">${x.pct}%</span></div><div class="mini"><i style="width:${x.pct}%"></i></div></div>`;
    }).join("") || '<div class="nc-empty">No active deals yet.</div>'}</div>`;
  }
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
  else if (STATE.view === "statements") body = statementsView();
  else if (STATE.view === "settings") body = settingsView();
  document.getElementById("main").innerHTML = body;
}

// ============================================================
// Dashboard
// ============================================================
function dashboard() {
  const outstanding = DB.deals.reduce((s, d) => s + dealOutstanding(d.id), 0);
  const realizedProfit = DB.deals.reduce((s, d) => s + dealRealizedProfit(d), 0);
  const allCash = getCashTransactionsByDateRange("", "");
  const cashIn = calculateCashInTotal(allCash), cashOut = calculateCashOutTotal(allCash);
  const overdue = DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) < 0);
  const soon = DB.qists.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) >= 0 && daysUntil(q.expectedDate) <= 7);
  const totalClients = DB.clients.length;
  const totalDeals = DB.deals.length;
  const ongoingDeals = DB.deals.filter(d => dealOutstanding(d.id) > 0).length;

  return layout(t("dash_title"), t("dash_sub"),
    `<div class="stats">
      <div class="card stat"><label>Total clients</label><strong>${totalClients}</strong></div>
      <div class="card stat"><label>Total deals</label><strong>${totalDeals}</strong></div>
      <div class="card stat"><label>Ongoing investments</label><strong class="amber">${ongoingDeals}</strong></div>
    </div>
    <div class="stats">
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
  const idx = d ? dealQists(d.id).findIndex(x => x.id === q.id) + 1 : 0;
  return `<div class="qbox ${cls}">
    ${q.status === "paid" ? '<div class="stamp">PAID</div>' : ''}
    <div class="qnum" style="cursor:pointer" onclick="goToQistDeal('${q.id}')" title="Open this deal">${c ? esc(c.name) : ""}${d?.itemDetails ? " · " + esc(d.itemDetails) : ""}${idx ? " · #" + idx : ""}</div>
    <div class="qamt">${money(q.amount)}</div>
    <div class="qdate">${dateFmt(q.expectedDate)}</div>
    <div class="status">${qistStatusLabel(q)}${q.receivedAmount > 0 && q.status !== "paid" ? ` · ${money(q.receivedAmount)} in` : ""}</div>
    <div class="qactions"><button class="btn small" onclick="openPayment('${q.id}')">${q.status === "paid" ? "View" : "Pay"}</button><button class="btn small" onclick="openQist('${q.id}')">Edit</button></div>
    ${q.status !== "paid" && c?.phone ? `<button class="btn small" style="width:100%;margin-top:5px" onclick="openWhatsAppComposer('${q.id}')">WhatsApp</button>` : ""}
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
    ${ds.map(d => { const v = investor(d.investorId); return `<div class="card truck"><div class="truck-head"><div><div class="truck-title">${esc(d.itemDetails || "Deal")}</div><div class="truck-sub">Investor: ${v ? esc(v.name) : "—"} · Kharid ${money(d.kharid)} + Munafa ${money(d.munafa)} = ${money(d.total)}</div></div><div class="actions"><button class="btn small" onclick="goToDealStatement('${c.id}','${d.id}')">Statement</button><button class="btn small" onclick="openDeal('${c.id}','${d.id}')">Edit deal</button><button class="btn small danger" onclick="deleteDeal('${d.id}')">Delete</button></div></div><div class="route">${dealQists(d.id).map(qbox).join("")}</div></div>`; }).join("") || '<div class="empty">No deals for this client.</div>'}`,
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
    <div class="section"><div class="section-head"><h3>Deals funded</h3></div>${ds.map(d => {
      const c = client(d.clientId), received = dealReceived(d.id), pct = d.total ? Math.round(received / d.total * 100) : 0;
      return `<div class="card truck">
        <div class="truck-head">
          <div><div class="truck-title">${esc(c?.name || "")} — ${esc(d.itemDetails || "Deal")}</div><div class="truck-sub">Purchased ${dateFmt(d.created)} · Kharid ${money(d.kharid)} + Munafa ${money(d.munafa)} = ${money(d.total)}</div></div>
          <div class="actions"><button class="btn small" onclick="goToDealStatement('${c?.id}','${d.id}')">Statement</button><button class="btn small" onclick="openDeal('${c?.id}','${d.id}')">Edit</button></div>
        </div>
        <div class="row" style="margin-top:12px"><span class="small muted">${pct}% received · ${money(dealOutstanding(d.id))} outstanding</span><b class="green">${money(dealRealizedProfit(d))} profit realized</b></div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join("") || '<div class="empty">No deals yet.</div>'}</div>`,
    `<button class="btn" onclick="setView('investors')">← Investors</button>`);
}

function selectInvestor(id) { STATE.activeInvestor = id; STATE.view = "investors"; closeMobileNav(); render(); }

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
  const from = STATE.cashFrom, to = STATE.cashTo, clientId = STATE.cashClient;
  const entries = getCashTransactionsByDateRange(from, to, clientId);
  const cashIn = calculateCashInTotal(entries), cashOut = calculateCashOutTotal(entries), net = calculateNetCashFlow(entries);
  const outstanding = DB.deals.reduce((s, d) => s + dealOutstanding(d.id), 0);
  const realizedProfit = DB.deals.reduce((s, d) => s + dealRealizedProfit(d), 0);
  const display = entries.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || ""));

  return layout("Cashbook", "Chronological ledger of every rupee in and out — also your Reports export",
    `<div class="filter-bar">
      <div class="field"><label>Date From</label><input type="date" value="${from}" onchange="STATE.cashFrom=this.value;render()"></div>
      <div class="field"><label>Date To</label><input type="date" value="${to}" onchange="STATE.cashTo=this.value;render()"></div>
      <div class="field"><label>Client</label><select onchange="STATE.cashClient=this.value;render()"><option value="">All clients</option>${DB.clients.map(c => `<option value="${c.id}" ${clientId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <button class="btn" onclick="STATE.cashFrom='';STATE.cashTo='';STATE.cashClient='';render()">Clear filters</button>
      <button class="btn" onclick="shareCashbookPDF()">📤 Send PDF via WhatsApp</button>
      <button class="btn primary" onclick="generateCashbookPDF()">⬇ Download PDF</button>
    </div>
    <div class="stats">
      <div class="card stat"><label>Total cash in</label><strong class="green">${money(cashIn)}</strong></div>
      <div class="card stat"><label>Total cash out</label><strong class="red">${money(cashOut)}</strong></div>
      <div class="card stat"><label>Net cash flow</label><strong class="${net >= 0 ? "green" : "red"}">${money(net)}</strong></div>
      <div class="card stat"><label>Outstanding debt</label><strong class="amber">${money(outstanding)}</strong></div>
      <div class="card stat"><label>Realized profit</label><strong class="green">${money(realizedProfit)}</strong></div>
    </div>
    <div class="payment-list">${display.map(e => {
      const { who, what } = cashEntryLabel(e);
      const label = who ? `${esc(who)} · ${esc(what)}` : esc(what);
      return `<div class="payment row"><div><b class="${e.type === "cash_in" ? "green" : "red"}">${e.type === "cash_in" ? "+ " : "− "}${money(e.amount)}</b><div class="small muted">${label}${e.notes && who ? " · " + esc(e.notes) : ""}</div></div><div class="small muted">${dateFmt(e.date)}</div></div>`;
    }).join("") || '<div class="empty">No cashbook entries in this filter.</div>'}</div>`, "");
}

// ============================================================
// Statements — searchable client → deal selector, a rich per-deal
// summary card with progress, and the message/PDF composer. Deals
// are only ever shown one at a time or as clearly separated
// sections under "All Deals" — never merged into one schedule.
// ============================================================
function statementsView() {
  const clientId = STATE.stmtClient;
  const c = clientId ? client(clientId) : null;
  const deals = c ? DB.deals.filter(d => d.clientId === c.id) : [];
  const dealSel = STATE.stmtDeal;

  let body = `<div class="card header-card">
    <div class="field full" style="position:relative">
      <label>Client</label>
      <input id="stmtClientSearch" placeholder="Search client by name..." value="${c ? esc(c.name) : ""}" oninput="filterStatementClients(this.value)" onfocus="showStatementClientList()" autocomplete="off">
      <div id="stmtClientList" class="autocomplete-list"></div>
    </div>
    ${c ? `<div class="field full" style="margin-top:12px"><label>Deal</label><select onchange="STATE.stmtDeal=this.value;STATE.stmtRemarks=(this.value&&this.value!=='all')?(deal(this.value)?.remarks||''):'';render()">
      <option value="">Select a deal…</option>
      <option value="all" ${dealSel === "all" ? "selected" : ""}>All Deals (${deals.length})</option>
      ${deals.map(d => `<option value="${d.id}" ${dealSel === d.id ? "selected" : ""}>${esc(d.itemDetails || "Deal")} • ${dateFmt(d.created)} • ${dealOutstanding(d.id) > 0 ? "Active" : "Completed"}</option>`).join("")}
    </select></div>` : '<p class="small muted" style="margin:10px 0 0">Search and pick a client above to see their deals — each deal keeps its own installments, dates, and profit, never combined.</p>'}
  </div>`;

  if (c && dealSel === "all" && deals.length) {
    body += renderAllDealsSummary(c, deals);
  } else if (c && dealSel && dealSel !== "all") {
    const d = deal(dealSel);
    if (d) body += renderDealSummaryCard(d) + renderStatementComposer([d.id], c);
  }

  return layout("Statements", "Per-deal WhatsApp & PDF statements — deals are never merged", body, "");
}

function filterStatementClients(q) {
  const list = document.getElementById("stmtClientList");
  if (!list) return;
  const query = (q || "").toLowerCase();
  const matches = DB.clients.filter(cl => (cl.name || "").toLowerCase().includes(query)).slice(0, 8);
  list.innerHTML = matches.map(cl => `<div class="ac-item" onmousedown="selectStatementClient('${cl.id}')">${esc(cl.name)}</div>`).join("") || `<div class="ac-item muted">No matching clients</div>`;
  list.style.display = "block";
}
function showStatementClientList() { filterStatementClients(document.getElementById("stmtClientSearch")?.value || ""); }
function selectStatementClient(id) {
  STATE.stmtClient = id; STATE.stmtDeal = ""; STATE.stmtRemarks = "";
  render();
}
document.addEventListener("click", e => {
  const list = document.getElementById("stmtClientList");
  if (list && !e.target.closest("#stmtClientSearch") && !e.target.closest("#stmtClientList")) list.style.display = "none";
});

function renderDealSummaryCard(d) {
  const c = client(d.clientId);
  const qs = dealQists(d.id);
  const paidCount = qs.filter(q => q.status === "paid").length;
  const received = dealReceived(d.id), remaining = dealOutstanding(d.id);
  const pct = d.total ? Math.round(received / d.total * 100) : 0;
  const upcoming = qs.filter(q => q.status !== "paid").sort((a, b) => (a.expectedDate || "").localeCompare(b.expectedDate || ""));
  const nextDue = upcoming[0];
  const overdueCount = qs.filter(q => q.status !== "paid" && daysUntil(q.expectedDate) < 0).length;
  return `<div class="card header-card">
    <div class="row"><div><h2 style="margin:0">${esc(c?.name || "")}</h2><div class="small muted">${esc(d.itemDetails || "Deal")} · Purchased ${dateFmt(d.created)}</div></div>${overdueCount ? `<span class="tag" style="background:var(--red-bg);color:var(--red);font-weight:800">${overdueCount} OVERDUE</span>` : ""}</div>
    <div class="metrics">
      <div class="metric"><label>Total Investment</label><strong style="font-size:22px">${money(d.total)}</strong></div>
      <div class="metric"><label>Paid</label><strong class="green" style="font-size:22px">${money(received)}</strong></div>
      <div class="metric"><label>Remaining</label><strong class="amber" style="font-size:22px">${money(remaining)}</strong></div>
      <div class="metric"><label>Profit</label><strong class="green" style="font-size:22px">${money(dealRealizedProfit(d))}</strong></div>
    </div>
    <div style="margin-top:18px"><b>${paidCount} / ${qs.length} Installments Completed</b> <span class="muted small">(${pct}% Complete)</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="row small muted" style="margin-top:8px"><span>Next due: ${nextDue ? dateFmt(nextDue.expectedDate) : "—"}</span>${overdueCount ? `<b class="red">Overdue now</b>` : `<span>On track</span>`}</div>
  </div>`;
}

function renderAllDealsSummary(c, deals) {
  const totalInvestment = deals.reduce((s, d) => s + Number(d.total || 0), 0);
  const totalPaid = deals.reduce((s, d) => s + dealReceived(d.id), 0);
  return `<div class="card header-card"><h2 style="margin:0 0 10px">${esc(c.name)} — All Deals</h2>
  <div class="metrics"><div class="metric"><label>Total deals</label><strong>${deals.length}</strong></div><div class="metric"><label>Combined investment</label><strong>${money(totalInvestment)}</strong></div><div class="metric"><label>Combined paid</label><strong class="green">${money(totalPaid)}</strong></div><div class="metric"><label>Combined outstanding</label><strong class="amber">${money(totalInvestment - totalPaid)}</strong></div></div>
  </div>
  ${deals.map(d => renderDealSummaryCard(d)).join("")}
  ${renderStatementComposer(deals.map(d => d.id), c)}`;
}

function renderStatementComposer(dealIds, c) {
  STMT_DEAL_IDS = dealIds;
  const lang = STATE.stmtLang || LANG;
  const showProfit = !!STATE.stmtShowProfit;
  const remarks = STATE.stmtRemarks || "";
  const msg = buildStatementMessage(dealIds, lang, showProfit, remarks);
  return `<div class="card header-card">
    <div class="row" style="flex-wrap:wrap;gap:14px;align-items:flex-start;justify-content:flex-start">
      <div><label class="small muted" style="display:block;margin-bottom:4px">Language</label><div class="filter"><button class="chip ${lang === "en" ? "active" : ""}" onclick="setStmtLang('en')">English</button><button class="chip ${lang === "ur" ? "active" : ""}" onclick="setStmtLang('ur')">اردو</button></div></div>
      <div><label class="small muted" style="display:block;margin-bottom:4px">Profit visibility</label><div class="filter"><button class="chip ${!showProfit ? "active" : ""}" onclick="setStmtProfit(false)">Hide profit</button><button class="chip ${showProfit ? "active" : ""}" onclick="setStmtProfit(true)">Show profit</button></div></div>
    </div>
    <div class="field full" style="margin-top:14px"><label>Remarks</label><textarea id="stmtRemarks" rows="2" oninput="STATE.stmtRemarks=this.value;document.getElementById('stmtMsg').value=buildStatementMessage(STMT_DEAL_IDS,(STATE.stmtLang||LANG),!!STATE.stmtShowProfit,this.value);document.getElementById('stmtPreview').textContent=document.getElementById('stmtMsg').value">${esc(remarks)}</textarea>
      ${dealIds.length === 1 ? `<button class="btn small" style="margin-top:6px" onclick="saveDealRemarks('${dealIds[0]}')">💾 Save remarks to this deal</button>` : `<p class="small muted" style="margin:6px 0 0">Remarks here apply only to this statement — saving to the database happens per individual deal.</p>`}
    </div>
    <div class="field full" style="margin-top:12px"><label>Message</label><textarea id="stmtMsg" rows="9" oninput="document.getElementById('stmtPreview').textContent=this.value">${esc(msg)}</textarea></div>
    <div class="field full"><label>Preview</label><div id="stmtPreview" class="wa-preview">${esc(msg)}</div></div>
    <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" onclick="downloadStatementPDF()">⬇ PDF</button><button class="btn small" onclick="shareStatementPDF()">📤 PDF via WhatsApp</button></div>
      <button class="btn primary" onclick="sendStatementWhatsApp('${c.id}')">Send message on WhatsApp</button>
    </div>
  </div>`;
}

function setStmtLang(lang) { STATE.stmtLang = lang; render(); }
function setStmtProfit(show) { STATE.stmtShowProfit = show; render(); }

// ============================================================
// Settings — Account (change email), Security (change password),
// Preferences (language/theme), Session (log out)
// ============================================================
function settingsView() {
  const email = CURRENT_SESSION?.user?.email || "";
  const themeIsDark = document.documentElement.getAttribute("data-theme") === "dark";
  return layout("Settings", "Account, security, and preferences", `
    <div class="card settings-card">
      <h3>Account</h3>
      <div class="settings-row"><div><b>Email</b><div class="small muted">${esc(email)}</div></div><button class="btn small" onclick="openChangeEmail()">Change email</button></div>
    </div>
    <div class="card settings-card">
      <h3>Security</h3>
      <div class="settings-row"><div><b>Password</b><div class="small muted">Change your account password</div></div><button class="btn small" onclick="openChangePassword()">Change password</button></div>
    </div>
    <div class="card settings-card">
      <h3>Preferences</h3>
      <div class="settings-row"><div><b>Language</b><div class="small muted">Interface labels only — your data stays as entered</div></div><button class="btn small" onclick="toggleLanguage()">${LANG === "en" ? "Switch to اردو" : "Switch to English"}</button></div>
      <div class="settings-row"><div><b>Theme</b><div class="small muted">Dark or light mode</div></div><button class="btn small" onclick="toggleTheme();render()">${themeIsDark ? "Switch to Light" : "Switch to Dark"}</button></div>
    </div>
    <div class="card settings-card">
      <h3>Session</h3>
      <div class="settings-row"><div><b>Signed in as ${esc(email)}</b></div><button class="btn small danger" onclick="doLogout()">Log out</button></div>
    </div>`, "");
}

function openChangePassword() {
  openModal(`<h3>Change password</h3><div class="form-grid">
  <div class="field full"><label>New password *</label><input id="npPass" type="password" autocomplete="new-password"></div>
  <div class="field full"><label>Confirm new password *</label><input id="npPass2" type="password" autocomplete="new-password"></div>
  </div><p class="small muted">Minimum 6 characters.</p>
  <div id="npErr" class="small" style="color:var(--red);display:none;margin-bottom:8px"></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="npBtn" onclick="saveNewPassword()">Change password</button></div>`);
}

async function saveNewPassword() {
  const p1 = document.getElementById("npPass").value, p2 = document.getElementById("npPass2").value;
  const err = document.getElementById("npErr"), btn = document.getElementById("npBtn");
  err.style.display = "none";
  if (!p1 || p1.length < 6) { err.textContent = "Password must be at least 6 characters."; err.style.display = "block"; return; }
  if (p1 !== p2) { err.textContent = "Passwords do not match."; err.style.display = "block"; return; }
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const { error } = await dbClient.auth.updateUser({ password: p1 });
    if (error) throw error;
    closeModal(); toast("Password updated");
  } catch (e) {
    err.textContent = e.message || "Failed to update password."; err.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Change password";
  }
}

function openChangeEmail() {
  const current = CURRENT_SESSION?.user?.email || "";
  openModal(`<h3>Change email</h3><div class="form-grid">
  <div class="field full"><label>New email *</label><input id="neEmail" type="email" value="${esc(current)}"></div>
  </div><p class="small muted">You'll get a confirmation link at the new address — the email only changes once you click it, not immediately.</p>
  <div id="neErr" class="small" style="color:var(--red);display:none;margin-bottom:8px"></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="neBtn" onclick="saveNewEmail()">Send confirmation</button></div>`);
}

async function saveNewEmail() {
  const email = document.getElementById("neEmail").value.trim();
  const err = document.getElementById("neErr"), btn = document.getElementById("neBtn");
  err.style.display = "none";
  if (!email || !email.includes("@")) { err.textContent = "Enter a valid email address."; err.style.display = "block"; return; }
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const { error } = await dbClient.auth.updateUser({ email });
    if (error) throw error;
    closeModal(); toast("Confirmation email sent — check your inbox to complete the change.");
  } catch (e) {
    err.textContent = e.message || "Failed to update email."; err.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Send confirmation";
  }
}

async function doLogout() {
  if (!confirm("Log out of Maal Ledger?")) return;
  try { await dbSignOut(); location.reload(); }
  catch (err) { alert("Logout failed: " + err.message); }
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
function setFilter(f) { STATE.filter = f; STATE.view = "all"; closeMobileNav(); render(); }
function setView(v) { STATE.view = v; STATE.activeClient = null; STATE.activeInvestor = null; closeMobileNav(); render(); }
function selectClient(id) { STATE.activeClient = id; STATE.view = "clients"; closeMobileNav(); render(); }
function mobileNav() {
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("sidebarBackdrop")?.classList.add("show");
}
function closeMobileNav() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebarBackdrop")?.classList.remove("show");
}

async function syncCloud() {
  toast("Refreshing from Supabase...");
  await loadDataFromSupabase();
  render();
  toast("Database up to date");
}

document.querySelectorAll(".nav button").forEach(b => b.onclick = () => { STATE.view = b.dataset.view; STATE.activeClient = null; STATE.activeInvestor = null; closeMobileNav(); render(); });
const searchBoxEl = document.getElementById("searchBox");
if (searchBoxEl) searchBoxEl.oninput = e => { STATE.search = e.target.value; renderSidebar(); };
const modalBackEl = document.getElementById("modalBack");
if (modalBackEl) modalBackEl.addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// App init — gated behind auth
initAuthGate();
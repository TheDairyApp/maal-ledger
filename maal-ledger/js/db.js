let DB = { investors: [], clients: [], deals: [], qists: [], cashbook: [], payouts: [] };

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function cacheDB() { localStorage.setItem("maal_cache", JSON.stringify(DB)); }

// ---- Offline write queue (payments only, for now — highest-value field use case) ----
function loadQueue() { try { return JSON.parse(localStorage.getItem("maal_queue") || "[]"); } catch (e) { return []; } }
function saveQueue(q) { localStorage.setItem("maal_queue", JSON.stringify(q)); }
function queuePending(op) { const q = loadQueue(); q.push(op); saveQueue(q); }
async function flushQueue() {
  const q = loadQueue();
  if (!q.length || !navigator.onLine) return;
  const remaining = [];
  for (const op of q) {
    try { if (op.type === "payment") await dbRecordQistPayment(op.qistId, op.amount, op.date, op.note, true); }
    catch (e) { remaining.push(op); }
  }
  saveQueue(remaining);
  if (remaining.length < q.length && typeof toast === "function") {
    toast(remaining.length ? `${q.length - remaining.length} synced, ${remaining.length} still pending` : "All offline changes synced");
    await loadDataFromSupabase(); if (typeof render === "function") render();
  }
}
if (typeof window !== "undefined") window.addEventListener("online", flushQueue);

// ---- Best-effort audit log (never blocks the calling action if it fails) ----
async function dbLogAudit(entity, entityId, action, details) {
  try {
    const email = (typeof CURRENT_SESSION !== "undefined" && CURRENT_SESSION?.user?.email) || "unknown";
    await dbClient.from("audit_log").insert({ id: uid("al"), entity, entity_id: entityId, action, details: String(details || ""), actor_email: email });
  } catch (e) { /* audit log is best-effort only */ }
}

async function dbFetchAuditLog(limit) {
  const { data, error } = await dbClient.from("audit_log").select("*").order("at", { ascending: false }).limit(limit || 50);
  if (error) throw error;
  return data || [];
}

// ---- Auth ----
async function dbGetSession() {
  const { data, error } = await dbClient.auth.getSession();
  if (error) throw error; return data.session;
}
async function dbSignIn(email, password) {
  const { data, error } = await dbClient.auth.signInWithPassword({ email, password });
  if (error) throw error; return data.session;
}
async function dbSignOut() {
  const { error } = await dbClient.auth.signOut();
  if (error) throw error;
}

// ---- Data Fetching & Caching ----
async function loadDataFromSupabase() {
  try {
    const [invRes, clRes, dRes, qRes, cbRes, poRes] = await Promise.all([
      dbClient.from("investors").select("*"), dbClient.from("clients").select("*"),
      dbClient.from("deals").select("*"), dbClient.from("qists").select("*"),
      dbClient.from("cashbook_entries").select("*"), dbClient.from("investor_payouts").select("*")
    ]);
    for (const r of [invRes, clRes, dRes, qRes, cbRes, poRes]) { if (r.error) throw r.error; }

    DB = {
      investors: (invRes.data || []).map(v => ({ ...v, textColor: v.text_color })),
      clients: clRes.data || [],
      deals: (dRes.data || []).map(d => ({ ...d, clientId: d.client_id, investorId: d.investor_id, itemDetails: d.item_details })),
      qists: (qRes.data || []).map(q => ({ ...q, dealId: q.deal_id, expectedDate: q.expected_date, receivedAmount: q.received_amount, receivedDate: q.received_date })),
      cashbook: (cbRes.data || []).map(e => ({ ...e, referenceId: e.reference_id })),
      payouts: (poRes.data || []).map(p => ({ ...p, investorId: p.investor_id }))
    };
    cacheDB(); // Save downloaded data to browser memory
    return DB;
  } catch (err) {
    const cached = localStorage.getItem("maal_cache");
    if (cached) DB = JSON.parse(cached); // If offline, load from memory
    console.error("Supabase error:", err); return DB;
  }
}

// ---- Update functions (Writes to Supabase, updates memory instantly) ----
async function dbUpsertInvestor(inv) {
  const { error } = await dbClient.from("investors").upsert({ id: inv.id, name: inv.name, type: inv.type, fill: inv.fill, bg: inv.bg, text_color: inv.textColor, notes: inv.notes });
  if (error) throw error;
  const idx = DB.investors.findIndex(x => x.id === inv.id);
  if (idx > -1) DB.investors[idx] = inv; else DB.investors.push(inv);
  cacheDB();
  dbLogAudit("investor", inv.id, idx > -1 ? "update" : "create", inv.name);
}
async function dbDeleteInvestor(id) {
  const { error } = await dbClient.from("investors").delete().eq("id", id);
  if (error) throw error;
  DB.investors = DB.investors.filter(x => x.id !== id); cacheDB();
}

async function dbUpsertClient(c) {
  const { error } = await dbClient.from("clients").upsert({ id: c.id, name: c.name, phone: c.phone, notes: c.notes });
  if (error) throw error;
  const idx = DB.clients.findIndex(x => x.id === c.id);
  if (idx > -1) DB.clients[idx] = c; else DB.clients.push(c);
  cacheDB();
  dbLogAudit("client", c.id, idx > -1 ? "update" : "create", c.name);
}
async function dbDeleteClient(id) {
  const { error } = await dbClient.from("clients").delete().eq("id", id);
  if (error) throw error;
  DB.clients = DB.clients.filter(x => x.id !== id); cacheDB();
}
// Soft delete — preferred over dbDeleteClient for the UI now; kept dbDeleteClient
// intact for permanent removal from the Trash view.
async function dbSoftDeleteClient(id) {
  const { error } = await dbClient.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  const c = DB.clients.find(x => x.id === id); if (c) c.deleted_at = new Date().toISOString();
  cacheDB(); dbLogAudit("client", id, "soft_delete", "");
}
async function dbRestoreClient(id) {
  const { error } = await dbClient.from("clients").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
  const c = DB.clients.find(x => x.id === id); if (c) c.deleted_at = null;
  cacheDB(); dbLogAudit("client", id, "restore", "");
}

async function dbUpsertDeal(deal, qistRows) {
  const isNew = !(await dbClient.from("deals").select("id").eq("id", deal.id).maybeSingle()).data;
  const { error: dErr } = await dbClient.from("deals").upsert({ id: deal.id, client_id: deal.clientId, investor_id: deal.investorId, item_details: deal.itemDetails, kharid: deal.kharid, munafa: deal.munafa });
  if (dErr) throw dErr;
  
  deal.total = Number(deal.kharid) + Number(deal.munafa);
  const idx = DB.deals.findIndex(x => x.id === deal.id);
  if (idx > -1) DB.deals[idx] = deal; else DB.deals.push(deal);

  if (qistRows && qistRows.length) {
    const newQists = qistRows.map((r, n) => ({ id: `${deal.id}_q${Date.now().toString(36)}${n}`, deal_id: deal.id, amount: r.amount, expected_date: r.expectedDate, received_amount: 0, status: "pending" }));
    const { error: qErr } = await dbClient.from("qists").insert(newQists);
    if (qErr) throw qErr;
    newQists.forEach(q => DB.qists.push({ id: q.id, dealId: q.deal_id, amount: q.amount, expectedDate: q.expected_date, receivedAmount: 0, status: "pending" }));
  }

  if (isNew && deal.kharid > 0) {
    const cb = { id: uid("cb"), type: "cash_out", amount: deal.kharid, referenceId: deal.id, date: new Date().toISOString().slice(0, 10), notes: `Kharid — ${deal.itemDetails || "deal"}` };
    await dbClient.from("cashbook_entries").insert({ id: cb.id, type: cb.type, amount: cb.amount, reference_id: cb.referenceId, date: cb.date, notes: cb.notes });
    DB.cashbook.push(cb);
  }
  cacheDB();
  dbLogAudit("deal", deal.id, isNew ? "create" : "update", deal.itemDetails || "");
}
async function dbDeleteDeal(id) {
  const qistIds = DB.qists.filter(q => q.dealId === id).map(q => q.id);
  const refs = [id, ...qistIds];
  await dbClient.from("cashbook_entries").delete().in("reference_id", refs);
  const { error } = await dbClient.from("deals").delete().eq("id", id);
  if (error) throw error;
  DB.deals = DB.deals.filter(x => x.id !== id);
  DB.qists = DB.qists.filter(x => x.dealId !== id);
  DB.cashbook = DB.cashbook.filter(x => !refs.includes(x.referenceId));
  cacheDB();
}
// Soft delete — preferred over dbDeleteDeal for the UI now; dbDeleteDeal kept
// intact for permanent removal from the Trash view.
async function dbSoftDeleteDeal(id) {
  const { error } = await dbClient.from("deals").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  const d = DB.deals.find(x => x.id === id); if (d) d.deleted_at = new Date().toISOString();
  cacheDB(); dbLogAudit("deal", id, "soft_delete", "");
}
async function dbRestoreDeal(id) {
  const { error } = await dbClient.from("deals").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
  const d = DB.deals.find(x => x.id === id); if (d) d.deleted_at = null;
  cacheDB(); dbLogAudit("deal", id, "restore", "");
}

// Persists PDF/WhatsApp statement remarks onto a specific deal only when the
// user explicitly opts in — remarks typed into a statement are otherwise
// transient (used just for that one message/PDF) and never auto-saved.
async function dbUpdateDealRemarks(dealId, remarks) {
  const { error } = await dbClient.from("deals").update({ remarks }).eq("id", dealId);
  if (error) throw error;
  const d = DB.deals.find(x => x.id === dealId);
  if (d) d.remarks = remarks;
  cacheDB();
}

async function dbUpdateQist(q) {
  const { error } = await dbClient.from("qists").update({ amount: q.amount, expected_date: q.expectedDate }).eq("id", q.id);
  if (error) throw error;
  const idx = DB.qists.findIndex(x => x.id === q.id);
  if (idx > -1) { DB.qists[idx].amount = q.amount; DB.qists[idx].expectedDate = q.expectedDate; }
  cacheDB();
}
async function dbDeleteQist(id) {
  await dbClient.from("cashbook_entries").delete().eq("reference_id", id);
  const { error } = await dbClient.from("qists").delete().eq("id", id);
  if (error) throw error;
  DB.qists = DB.qists.filter(x => x.id !== id);
  DB.cashbook = DB.cashbook.filter(x => x.referenceId !== id);
  cacheDB();
}

async function dbRecordQistPayment(qistId, amount, date, note, _fromQueue) {
  const q = DB.qists.find(x => x.id === qistId);
  const newReceived = Number(q.receivedAmount || 0) + Number(amount);
  const status = newReceived <= 0 ? "pending" : newReceived >= Number(q.amount) ? "paid" : "partial";
  q.receivedAmount = newReceived; q.receivedDate = date; q.status = status;
  const cb = { id: uid("cb"), type: "cash_in", amount: Number(amount), referenceId: qistId, date, notes: note || "" };
  DB.cashbook.push(cb); cacheDB();

  try {
    const { error: uErr } = await dbClient.from("qists").update({ received_amount: newReceived, received_date: date, status }).eq("id", qistId);
    if (uErr) throw uErr;
    await dbClient.from("cashbook_entries").insert({ id: cb.id, type: cb.type, amount: cb.amount, reference_id: cb.referenceId, date: cb.date, notes: cb.notes });
    dbLogAudit("qist", qistId, "payment", `+${amount} on ${date}`);
  } catch (err) {
    if (!_fromQueue) { queuePending({ type: "payment", qistId, amount, date, note }); if (typeof toast === "function") toast("Offline — payment saved locally, will sync automatically"); }
    else throw err;
  }
}

// Undoes the most recent payment recorded against a qist: finds its latest
// cash_in cashbook entry, subtracts that amount back off receivedAmount,
// recalculates status/receivedDate, and removes that cashbook entry.
// Only reverses one payment at a time (the last one), not the whole history.
async function dbReversePayment(qistId) {
  const q = DB.qists.find(x => x.id === qistId);
  if (!q) throw new Error("Installment not found.");

  const entries = DB.cashbook.filter(e => e.type === "cash_in" && e.referenceId === qistId)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.id || "").localeCompare(b.id || ""));
  const last = entries[entries.length - 1];
  if (!last) throw new Error("No payment found to undo for this installment.");

  const newReceived = Math.max(0, Number(q.receivedAmount || 0) - Number(last.amount));
  const remaining = entries.slice(0, -1);
  const newDate = remaining.length ? remaining[remaining.length - 1].date : null;
  const status = newReceived <= 0 ? "pending" : newReceived >= Number(q.amount) ? "paid" : "partial";

  const { error: uErr } = await dbClient.from("qists").update({ received_amount: newReceived, received_date: newDate, status }).eq("id", qistId);
  if (uErr) throw uErr;
  const { error: dErr } = await dbClient.from("cashbook_entries").delete().eq("id", last.id);
  if (dErr) throw dErr;

  q.receivedAmount = newReceived; q.receivedDate = newDate; q.status = status;
  DB.cashbook = DB.cashbook.filter(e => e.id !== last.id);
  cacheDB();
  dbLogAudit("qist", qistId, "undo_payment", `-${last.amount} (was recorded on ${last.date})`);
  return last;
}

async function dbInsertPayout(po) {
  const { error } = await dbClient.from("investor_payouts").insert({ id: po.id, investor_id: po.investorId, amount: po.amount, date: po.date, notes: po.notes });
  if (error) throw error;
  DB.payouts.push(po);
  
  const cb = { id: uid("cb"), type: "cash_out", amount: po.amount, referenceId: po.id, date: po.date, notes: po.notes || "Investor payout" };
  await dbClient.from("cashbook_entries").insert({ id: cb.id, type: cb.type, amount: cb.amount, reference_id: cb.referenceId, date: cb.date, notes: cb.notes });
  DB.cashbook.push(cb); cacheDB();
  dbLogAudit("investor", po.investorId, "payout", `${po.amount} on ${po.date}`);
}
async function dbDeletePayout(id) {
  await dbClient.from("cashbook_entries").delete().eq("reference_id", id);
  const { error } = await dbClient.from("investor_payouts").delete().eq("id", id);
  if (error) throw error;
  DB.payouts = DB.payouts.filter(x => x.id !== id);
  DB.cashbook = DB.cashbook.filter(x => x.referenceId !== id);
  cacheDB();
}

// ---- Investor read-only share links (no login) ----
async function dbGenerateShareToken(investorId) {
  const token = uid("tok").replace(/[^a-z0-9]/gi, "");
  const { error } = await dbClient.from("investors").update({ share_token: token }).eq("id", investorId);
  if (error) throw error;
  const v = DB.investors.find(x => x.id === investorId); if (v) v.share_token = token;
  cacheDB();
  return token;
}
async function dbRevokeShareToken(investorId) {
  const { error } = await dbClient.from("investors").update({ share_token: null }).eq("id", investorId);
  if (error) throw error;
  const v = DB.investors.find(x => x.id === investorId); if (v) v.share_token = null;
  cacheDB();
}
// Uses the public "share_token" RLS policies — works without any session.
async function dbFetchSharedInvestor(token) {
  const { data: inv } = await dbClient.from("investors").select("*").eq("share_token", token).maybeSingle();
  if (!inv) return null;
  const { data: deals } = await dbClient.from("deals").select("*").eq("investor_id", inv.id);
  const dealIds = (deals || []).map(d => d.id);
  const { data: qists } = dealIds.length ? await dbClient.from("qists").select("*").in("deal_id", dealIds) : { data: [] };
  const clientIds = [...new Set((deals || []).map(d => d.client_id))];
  const { data: clients } = clientIds.length ? await dbClient.from("clients").select("*").in("id", clientIds) : { data: [] };
  return {
    investor: { ...inv, textColor: inv.text_color },
    deals: (deals || []).map(d => ({ ...d, clientId: d.client_id, investorId: d.investor_id, itemDetails: d.item_details })),
    qists: (qists || []).map(q => ({ ...q, dealId: q.deal_id, expectedDate: q.expected_date, receivedAmount: q.received_amount, receivedDate: q.received_date })),
    clients: clients || []
  };
}
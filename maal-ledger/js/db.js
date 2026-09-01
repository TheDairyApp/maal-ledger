let DB = { investors: [], clients: [], deals: [], qists: [], cashbook: [], payouts: [] };

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function cacheDB() { localStorage.setItem("maal_cache", JSON.stringify(DB)); }

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
}
async function dbDeleteClient(id) {
  const { error } = await dbClient.from("clients").delete().eq("id", id);
  if (error) throw error;
  DB.clients = DB.clients.filter(x => x.id !== id); cacheDB();
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

async function dbRecordQistPayment(qistId, amount, date, note) {
  const q = DB.qists.find(x => x.id === qistId);
  const newReceived = Number(q.receivedAmount || 0) + Number(amount);
  const status = newReceived <= 0 ? "pending" : newReceived >= Number(q.amount) ? "paid" : "partial";

  const { error: uErr } = await dbClient.from("qists").update({ received_amount: newReceived, received_date: date, status }).eq("id", qistId);
  if (uErr) throw uErr;
  q.receivedAmount = newReceived; q.receivedDate = date; q.status = status;
  
  const cb = { id: uid("cb"), type: "cash_in", amount: Number(amount), referenceId: qistId, date, notes: note || "" };
  await dbClient.from("cashbook_entries").insert({ id: cb.id, type: cb.type, amount: cb.amount, reference_id: cb.referenceId, date: cb.date, notes: cb.notes });
  DB.cashbook.push(cb); cacheDB();
}

async function dbInsertPayout(po) {
  const { error } = await dbClient.from("investor_payouts").insert({ id: po.id, investor_id: po.investorId, amount: po.amount, date: po.date, notes: po.notes });
  if (error) throw error;
  DB.payouts.push(po);
  
  const cb = { id: uid("cb"), type: "cash_out", amount: po.amount, referenceId: po.id, date: po.date, notes: po.notes || "Investor payout" };
  await dbClient.from("cashbook_entries").insert({ id: cb.id, type: cb.type, amount: cb.amount, reference_id: cb.referenceId, date: cb.date, notes: cb.notes });
  DB.cashbook.push(cb); cacheDB();
}
async function dbDeletePayout(id) {
  await dbClient.from("cashbook_entries").delete().eq("reference_id", id);
  const { error } = await dbClient.from("investor_payouts").delete().eq("id", id);
  if (error) throw error;
  DB.payouts = DB.payouts.filter(x => x.id !== id);
  DB.cashbook = DB.cashbook.filter(x => x.referenceId !== id);
  cacheDB();
}
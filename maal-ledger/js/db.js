// ============================================================
// Maal Ledger — data layer (js/db.js)
// All Supabase reads/writes live here. app.js never touches
// dbClient directly — it calls the functions below.
// Assumes supabase-config.js has already created `dbClient`.
// ============================================================

let DB = { investors: [], clients: [], deals: [], qists: [], cashbook: [], payouts: [] };

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ------------------------------------------------------------
// Auth — RLS is locked to `authenticated`, so nothing below
// will return data until a session exists.
// ------------------------------------------------------------
async function dbGetSession() {
  const { data, error } = await dbClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function dbSignIn(email, password) {
  const { data, error } = await dbClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function dbSignOut() {
  const { error } = await dbClient.auth.signOut();
  if (error) throw error;
}

// ------------------------------------------------------------
// Load everything
// ------------------------------------------------------------
async function loadDataFromSupabase() {
  try {
    const [invRes, clRes, dRes, qRes, cbRes, poRes] = await Promise.all([
      dbClient.from("investors").select("*"),
      dbClient.from("clients").select("*"),
      dbClient.from("deals").select("*"),
      dbClient.from("qists").select("*"),
      dbClient.from("cashbook_entries").select("*"),
      dbClient.from("investor_payouts").select("*")
    ]);

    for (const r of [invRes, clRes, dRes, qRes, cbRes, poRes]) {
      if (r.error) throw r.error;
    }

    DB = {
      investors: (invRes.data || []).map(v => ({ ...v, textColor: v.text_color })),
      clients: clRes.data || [],
      deals: (dRes.data || []).map(d => ({ ...d, clientId: d.client_id, investorId: d.investor_id, itemDetails: d.item_details })),
      qists: (qRes.data || []).map(q => ({
        ...q, dealId: q.deal_id, expectedDate: q.expected_date,
        receivedAmount: q.received_amount, receivedDate: q.received_date
      })),
      cashbook: (cbRes.data || []).map(e => ({ ...e, referenceId: e.reference_id })),
      payouts: (poRes.data || []).map(p => ({ ...p, investorId: p.investor_id }))
    };

    return DB;
  } catch (err) {
    console.error("Supabase load error:", err);
    toast("Database sync error: " + err.message);
    return DB;
  }
}

// ------------------------------------------------------------
// Investors
// ------------------------------------------------------------
async function dbUpsertInvestor(inv) {
  const { error } = await dbClient.from("investors").upsert({
    id: inv.id, name: inv.name, type: inv.type, fill: inv.fill, bg: inv.bg,
    text_color: inv.textColor, notes: inv.notes
  });
  if (error) throw error;
}

async function dbDeleteInvestor(id) {
  const { error } = await dbClient.from("investors").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// Clients
// ------------------------------------------------------------
async function dbUpsertClient(c) {
  const { error } = await dbClient.from("clients").upsert({
    id: c.id, name: c.name, phone: c.phone, notes: c.notes
  });
  if (error) throw error;
}

async function dbDeleteClient(id) {
  const { error } = await dbClient.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// Deals — creating a deal also logs the Kharid as a cash-out
// cashbook entry (the capital left the pool to fund the purchase).
// ------------------------------------------------------------
async function dbUpsertDeal(deal, qistRows) {
  const isNew = !(await dbClient.from("deals").select("id").eq("id", deal.id).maybeSingle()).data;

  const { error: dErr } = await dbClient.from("deals").upsert({
    id: deal.id, client_id: deal.clientId, investor_id: deal.investorId,
    item_details: deal.itemDetails, kharid: deal.kharid, munafa: deal.munafa
  });
  if (dErr) throw dErr;

  if (qistRows && qistRows.length) {
    const { error: qErr } = await dbClient.from("qists").insert(
      qistRows.map((r, n) => ({
        id: `${deal.id}_q${Date.now().toString(36)}${n}`,
        deal_id: deal.id, amount: r.amount, expected_date: r.expectedDate,
        received_amount: 0, status: "pending"
      }))
    );
    if (qErr) throw qErr;
  }

  if (isNew && deal.kharid > 0) {
    await dbInsertCashbookEntry({
      id: uid("cb"), type: "cash_out", amount: deal.kharid, referenceId: deal.id,
      date: new Date().toISOString().slice(0, 10), notes: `Kharid — ${deal.itemDetails || "deal"}`
    });
  }
}

async function dbDeleteDeal(id) {
  const qistIds = (await dbClient.from("qists").select("id").eq("deal_id", id)).data?.map(q => q.id) || [];
  const refs = [id, ...qistIds];
  await dbClient.from("cashbook_entries").delete().in("reference_id", refs);
  const { error } = await dbClient.from("deals").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// Qists
// ------------------------------------------------------------
async function dbAddQist(dealId, row) {
  const { error } = await dbClient.from("qists").insert({
    id: uid("q"), deal_id: dealId, amount: row.amount, expected_date: row.expectedDate,
    received_amount: 0, status: "pending"
  });
  if (error) throw error;
}

async function dbUpdateQist(q) {
  const { error } = await dbClient.from("qists").update({
    amount: q.amount, expected_date: q.expectedDate
  }).eq("id", q.id);
  if (error) throw error;
}

async function dbDeleteQist(id) {
  await dbClient.from("cashbook_entries").delete().eq("reference_id", id);
  const { error } = await dbClient.from("qists").delete().eq("id", id);
  if (error) throw error;
}

// Records a payment against a qist: bumps received_amount/received_date/status,
// and logs a cash_in cashbook entry for the amount actually paid just now.
async function dbRecordQistPayment(qistId, amount, date, note) {
  const { data: q, error: gErr } = await dbClient.from("qists").select("*").eq("id", qistId).single();
  if (gErr) throw gErr;

  const newReceived = Number(q.received_amount || 0) + Number(amount);
  const status = newReceived <= 0 ? "pending" : newReceived >= Number(q.amount) ? "paid" : "partial";

  const { error: uErr } = await dbClient.from("qists").update({
    received_amount: newReceived, received_date: date, status
  }).eq("id", qistId);
  if (uErr) throw uErr;

  await dbInsertCashbookEntry({
    id: uid("cb"), type: "cash_in", amount: Number(amount), referenceId: qistId, date, notes: note || ""
  });
}

// ------------------------------------------------------------
// Investor payouts — recording a payout also logs it as a
// cash-out cashbook entry, since it's real cash leaving the business.
// ------------------------------------------------------------
async function dbInsertPayout(payout) {
  const { error } = await dbClient.from("investor_payouts").insert({
    id: payout.id, investor_id: payout.investorId, amount: payout.amount, date: payout.date, notes: payout.notes
  });
  if (error) throw error;

  await dbInsertCashbookEntry({
    id: uid("cb"), type: "cash_out", amount: payout.amount, referenceId: payout.id,
    date: payout.date, notes: payout.notes || "Investor payout"
  });
}

async function dbDeletePayout(id) {
  await dbClient.from("cashbook_entries").delete().eq("reference_id", id);
  const { error } = await dbClient.from("investor_payouts").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------
// Cashbook
// ------------------------------------------------------------
async function dbInsertCashbookEntry(entry) {
  const { error } = await dbClient.from("cashbook_entries").insert({
    id: entry.id, type: entry.type, amount: entry.amount, reference_id: entry.referenceId,
    date: entry.date, notes: entry.notes
  });
  if (error) throw error;
}

async function dbDeleteCashbookEntry(id) {
  const { error } = await dbClient.from("cashbook_entries").delete().eq("id", id);
  if (error) throw error;
}

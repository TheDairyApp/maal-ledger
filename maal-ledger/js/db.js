const OWNER_COLORS = {
  "Self": { fill: "#0F766E", bg: "#E4F5F1", text: "#0B5A54" },
  "Baji": { fill: "#B45309", bg: "#FFF1DE", text: "#8A4108" },
  "Ch Tahir": { fill: "#6D28D9", bg: "#EEE8FC", text: "#5420AE" }
};

const SEED_DATA = [
  { owner: "Self", client: "Samdani", deal: "10 Aug 2026 · 12 items", total: 6530000, installments: [[1, 1088500, "2026-09-10"], [2, 1088500, "2026-10-10"], [3, 1088500, "2026-11-10"], [4, 1088500, "2026-12-10"], [5, 1088000, "2027-01-10"], [6, 1088000, "2027-02-10"]] },
  { owner: "Self", client: "Mufti Amir c/o Arif", deal: "1 Aug 2026 · 6 items", total: 3000000, installments: [[1, 1000000, "2026-09-01"], [2, 1000000, "2026-10-01"], [3, 1000000, "2026-11-01"]] },
  { owner: "Self", client: "Noman Yahya", deal: "8 Apr 2026 · 12 items", total: 7200000, installments: [[4, 1440000, "2026-08-10"], [5, 1440000, "2026-09-10"]] },
  { owner: "Self", client: "Noman Yahya", deal: "5 Aug 2026 · 6 items", total: 3752000, installments: [[1, 750400, "2026-09-05"], [2, 750400, "2026-10-05"], [3, 750400, "2026-11-05"], [4, 750400, "2026-12-05"], [5, 750400, "2027-01-05"]] },
  { owner: "Self", client: "Mubeen Memon", deal: "18 May 2026 · 12 items", total: 6980000, installments: [[3, 1396000, "2026-08-20"], [4, 1396000, "2026-09-20"], [5, 1396000, "2026-10-20"]] },
  { owner: "Self", client: "Arif 10 / Fahad", deal: "12 May 2026 · 6 items", total: 3278000, installments: [[3, 655600, "2026-08-23"], [4, 655600, "2026-09-23"], [5, 655600, "2026-10-23"]] },
  { owner: "Self", client: "Arif 9", deal: "1 Apr 2026 · 3 items", total: 1507500, installments: [[4, 301500, "2026-08-15"], [5, 301500, "2026-09-15"]] },
  { owner: "Baji", client: "Arif 9", deal: "1 Apr 2026 · 3 items (Baji's share)", total: 1507500, installments: [[4, 301500, "2026-08-15"], [5, 301500, "2026-09-15"]] },
  { owner: "Baji", client: "Mubin", deal: "20 May 2026 · 2 items", total: 1247000, installments: [[3, 249400, "2026-08-23"], [4, 249400, "2026-09-23"], [5, 249400, "2026-10-23"]] },
  { owner: "Ch Tahir", client: "Mubin", deal: "20 May 2026 · 4 items", total: 2493000, installments: [[3, 498600, "2026-08-23"], [4, 498600, "2026-09-23"], [5, 498600, "2026-10-23"]] }
];

let DB = { customers: [], deals: [], installments: [], payments: [] };

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Fetch all tables from Supabase
async function loadDataFromSupabase() {
  try {
    const [cRes, dRes, iRes, pRes] = await Promise.all([
      dbClient.from("customers").select("*"),
      dbClient.from("deals").select("*"),
      dbClient.from("installments").select("*"),
      dbClient.from("payments").select("*")
    ]);

    if (cRes.error) throw cRes.error;
    if (dRes.error) throw dRes.error;
    if (iRes.error) throw iRes.error;
    if (pRes.error) throw pRes.error;

    // If Supabase database is empty on first run, auto-seed with original records
    if (!cRes.data || cRes.data.length === 0) {
      await seedInitialData();
      return await loadDataFromSupabase();
    }

    DB = {
      customers: cRes.data || [],
      deals: (dRes.data || []).map(d => ({ ...d, customerId: d.customer_id })),
      installments: (iRes.data || []).map(i => ({ ...i, dealId: i.deal_id })),
      payments: (pRes.data || []).map(p => ({ ...p, installmentId: p.installment_id }))
    };

    return DB;
  } catch (err) {
    console.error("Supabase load error:", err);
    toast("Database sync error: " + err.message);
    return DB;
  }
}

// Auto seed initial ledger data to Supabase
async function seedInitialData() {
  const customers = [], deals = [], installments = [];
  const cMap = {};

  SEED_DATA.forEach((r, ri) => {
    if (!cMap[r.client]) {
      const id = "c_" + Object.keys(cMap).length;
      cMap[r.client] = { id, name: r.client, phone: "", notes: "" };
      customers.push(cMap[r.client]);
    }
    const dealId = "d_" + ri;
    deals.push({
      id: dealId,
      customer_id: cMap[r.client].id,
      owner: r.owner,
      title: r.deal,
      total: r.total,
      created: r.deal.split(" · ")[0]
    });
    r.installments.forEach((v, ii) => {
      installments.push({
        id: `${dealId}_${ii}`,
        deal_id: dealId,
        qist: v[0],
        amount: v[1],
        due: v[2]
      });
    });
  });

  await dbClient.from("customers").upsert(customers);
  await dbClient.from("deals").upsert(deals);
  await dbClient.from("installments").upsert(installments);
}

// Supabase Async Operations
async function dbUpsertCustomer(customer) {
  const { error } = await dbClient.from("customers").upsert({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    notes: customer.notes
  });
  if (error) throw error;
}

async function dbDeleteCustomer(id) {
  const { error } = await dbClient.from("customers").delete().eq("id", id);
  if (error) throw error;
}

async function dbUpsertDeal(deal, installmentRows) {
  const { error: dErr } = await dbClient.from("deals").upsert({
    id: deal.id,
    customer_id: deal.customerId,
    owner: deal.owner,
    title: deal.title,
    total: deal.total,
    created: deal.created
  });
  if (dErr) throw dErr;

  // Clear existing installments for this deal and replace
  await dbClient.from("installments").delete().eq("deal_id", deal.id);
  const { error: iErr } = await dbClient.from("installments").insert(
    installmentRows.map((r, n) => ({
      id: `${deal.id}_${n}`,
      deal_id: deal.id,
      qist: r.qist,
      amount: r.amount,
      due: r.due
    }))
  );
  if (iErr) throw iErr;
}

async function dbDeleteDeal(id) {
  const { error } = await dbClient.from("deals").delete().eq("id", id);
  if (error) throw error;
}

async function dbUpdateInstallment(id, qist, amount, due) {
  const { error } = await dbClient.from("installments").update({ qist, amount, due }).eq("id", id);
  if (error) throw error;
}

async function dbDeleteInstallment(id) {
  const { error } = await dbClient.from("installments").delete().eq("id", id);
  if (error) throw error;
}

async function dbInsertPayment(payment) {
  const { error } = await dbClient.from("payments").insert({
    id: payment.id,
    installment_id: payment.installmentId,
    amount: payment.amount,
    date: payment.date,
    method: payment.method,
    note: payment.note
  });
  if (error) throw error;
}
let STATE = { view: "dashboard", activeCustomer: null, filter: "all", search: "" };



// --- AUTHENTICATION ---
async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorDiv = document.getElementById("loginError");

  if (!email || !password) {
    errorDiv.textContent = "Please enter both email and password.";
    return;
  }

  errorDiv.textContent = "Signing in...";

  // Attempt to sign in with Supabase
  const { data, error } = await dbClient.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    errorDiv.textContent = error.message; // Show invalid credentials error
  } else {
    // Success! Clear errors and hide the login screen
    errorDiv.textContent = "";
    document.getElementById("loginOverlay").classList.add("hidden");
    
    // Fetch the secured data and render the dashboard
    await syncCloud(); 
  }
}


async function handleSignOut() {
  toast("Signing out...");
  const { error } = await dbClient.auth.signOut();
  
  if (error) {
    alert("Error signing out: " + error.message);
  } else {
    // Show the login screen again
    document.getElementById("loginOverlay").classList.remove("hidden");
    
    // Clear the current app state from memory
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginError").textContent = "";
    
    STATE.activeCustomer = null;
    document.getElementById("main").innerHTML = ""; // Clear dashboard view
  }
}


function money(n) { return "Rs " + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
function dateFmt(d) { if (!d) return "—"; return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function daysUntil(d) { const a = new Date(); a.setHours(0, 0, 0, 0); return Math.round((new Date(d + "T00:00:00") - a) / 86400000); }
function customer(id) { return DB.customers.find(x => x.id === id); }
function deal(id) { return DB.deals.find(x => x.id === id); }
function paymentsFor(instId) { return DB.payments.filter(p => p.installmentId === instId); }
function received(instId) { return paymentsFor(instId).reduce((s, p) => s + Number(p.amount || 0), 0); }
function status(i) { if (received(i.id) >= Number(i.amount)) return "paid"; let d = daysUntil(i.due); if (d < 0) return "overdue"; if (d <= 7) return "soon"; return "future"; }
function all() { return DB.installments.map(i => ({ ...i, deal: deal(i.dealId), customer: customer(deal(i.dealId)?.customerId) })).filter(x => x.deal && x.customer); }
function custStats(cid) {
  const xs = all().filter(i => i.customer.id === cid), total = xs.reduce((s, i) => s + Number(i.amount), 0), got = xs.reduce((s, i) => s + Math.min(received(i.id), Number(i.amount)), 0);
  return { items: xs, total, got, out: Math.max(0, total - got), pct: total ? Math.round(got / total * 100) : 0 };
}
function initials(n) { return (n || "").split(/[\s\/]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase(); }
function toast(s) { const t = document.getElementById("toast"); t.textContent = s; t.classList.add("show"); clearTimeout(window._toast); window._toast = setTimeout(() => t.classList.remove("show"), 2200); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

function wa(inst) {
  const c = inst.customer, msg = `Hi ${c.name}, your installment No. ${inst.qist} of ${money(inst.amount)} is due on ${dateFmt(inst.due)}. Kindly confirm once paid. Thank you!`;
  const phone = (c.phone || "").replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

function qbox(i) {
  const st = status(i), label = { paid: "Paid", overdue: "Overdue", soon: "Due soon", future: "Upcoming" }[st], got = received(i.id);
  return `<div class="qbox ${st}">
    ${st === "paid" ? '<div class="stamp">PAID</div>' : ''}
    <div class="qnum">QIST ${i.qist}</div>
    <div class="qamt">${money(i.amount)}</div>
    <div class="qdate">${dateFmt(i.due)}</div>
    <div class="status">${label}${got && st !== "paid" ? ` · ${money(got)} received` : ""}</div>
    <div class="qactions">
      <button class="btn small" onclick="openPayment('${i.id}')">${st === "paid" ? "View" : "Pay"}</button>
      <a class="btn small" target="_blank" href="${wa(i)}">WhatsApp</a>
    </div>
    <button class="btn small" style="width:100%;margin-top:5px" onclick="openInstallment('${i.id}')">Edit</button>
  </div>`;
}

function renderSidebar() {
  const q = STATE.search.toLowerCase();
  const cs = DB.customers.filter(c => (c.name || "").toLowerCase().includes(q));
  document.getElementById("custList").innerHTML = cs.map(c => {
    const s = custStats(c.id), active = STATE.activeCustomer === c.id && STATE.view === "customers";
    return `<div class="cust-item ${active ? "active" : ""}" onclick="selectCustomer('${c.id}')">
      <div class="avatar" style="background:${OWNER_COLORS[DB.deals.find(d => d.customerId === c.id)?.owner]?.fill || "#555"}">${initials(c.name)}</div>
      <div class="cust-info"><div class="cust-name">${esc(c.name)}</div><div class="cust-meta">${s.pct}% paid · ${money(s.out)} out</div><div class="mini"><i style="width:${s.pct}%"></i></div></div>
    </div>`;
  }).join("") || `<div style="padding:15px;color:#98a2b5;font-size:12px">No customers found.</div>`;
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
  else if (STATE.view === "customers") body = customers();
  else if (STATE.view === "trucks") body = trucksView(); // Routing to our new view
  else body = allQists();
  document.getElementById("main").innerHTML = body;
}

function dashboard() {
  const xs = all(), total = xs.reduce((s, i) => s + Number(i.amount), 0), got = xs.reduce((s, i) => s + Math.min(received(i.id), Number(i.amount)), 0);
  const overdue = xs.filter(i => status(i) === "overdue"), soon = xs.filter(i => status(i) === "soon"), out = total - got;
  const owner = DB.investors.map(inv => inv.name).map(o => {
    let a = xs.filter(i => i.deal.owner === o), t = a.reduce((s, i) => s + Number(i.amount), 0), p = a.reduce((s, i) => s + Math.min(received(i.id), Number(i.amount)), 0);
    return { o, t, p, out: t - p };
  });

  return layout("Dashboard", "Live cloud overview of your livestock installment ledger",
    `<div class="stats">
      <div class="card stat"><label>Total ledger value</label><strong>${money(total)}</strong></div>
      <div class="card stat"><label>Received</label><strong class="green">${money(got)}</strong></div>
      <div class="card stat"><label>Outstanding</label><strong class="amber">${money(out)}</strong></div>
      <div class="card stat"><label>Overdue qists</label><strong class="red">${overdue.length}</strong></div>
      <div class="card stat"><label>Due within 7 days</label><strong>${soon.length}</strong></div>
    </div>
    ${overdue.length ? `<div class="alert"><b>${overdue.length} overdue qist${overdue.length > 1 ? "s" : ""}</b> · ${money(overdue.reduce((s, i) => s + Number(i.amount) - received(i.id), 0))} still outstanding.</div>` : ""}
    <div class="section"><div class="section-head"><h3>By investor</h3></div><div class="owner-grid">${owner.map(r => `<div class="card owner"><div><span class="dot" style="background:${OWNER_COLORS[r.o].fill}"></span> <b>${r.o}</b></div><div class="small muted" style="margin-top:12px">Total</div><b>${money(r.t)}</b><div class="small muted" style="margin-top:8px">Received ${money(r.p)}</div><div class="small muted">Outstanding ${money(r.out)}</div></div>`).join("")}</div></div>
    <div class="section"><div class="section-head"><h3>Overdue</h3><button class="btn small" onclick="setFilter('overdue')">View all</button></div><div class="qgrid">${overdue.slice(0, 8).map(qbox).join("") || '<div class="empty">No overdue installments 🎉</div>'}</div></div>
    <div class="section"><div class="section-head"><h3>Due soon</h3><button class="btn small" onclick="setFilter('soon')">View all</button></div><div class="qgrid">${soon.slice(0, 8).map(qbox).join("") || '<div class="empty">Nothing due in the next 7 days.</div>'}</div></div>`,
    `<button class="btn primary" onclick="openCustomer()">+ Customer</button><button class="btn" onclick="openDeal()">+ Deal</button><button class="btn" onclick="syncCloud()">↻ Refresh</button>`);
}

function customers() {
  if (!STATE.activeCustomer) {
    const cs = DB.customers;
    return layout("Customers", `${cs.length} customers in your ledger`,
      `<div class="grid">${cs.map(c => {
        const s = custStats(c.id);
        return `<div class="card customer-card" onclick="selectCustomer('${c.id}')"><div class="row"><div><b>${esc(c.name)}</b><div class="small muted">${c.phone || "No WhatsApp number"}</div></div><div class="avatar" style="background:${OWNER_COLORS[DB.deals.find(d => d.customerId === c.id)?.owner]?.fill || "#555"}">${initials(c.name)}</div></div><div class="row" style="margin-top:14px"><span class="small muted">${s.pct}% paid</span><b>${money(s.out)}</b></div><div class="progress"><i style="width:${s.pct}%"></i></div><div class="actions" style="margin-top:12px"><button class="btn small" onclick="event.stopPropagation();openCustomer('${c.id}')">Edit</button><button class="btn small danger" onclick="event.stopPropagation();deleteCustomer('${c.id}')">Delete</button></div></div>`;
      }).join("") || '<div class="empty">No customers yet.</div>'}</div>`,
      `<button class="btn primary" onclick="openCustomer()">+ Add Customer</button>`);
  }

  const c = customer(STATE.activeCustomer), s = custStats(c.id), ds = DB.deals.filter(d => d.customerId === c.id);
  return layout("Customer", "Complete account and payment history",
    `<div class="card header-card"><div class="row"><div><h2>${esc(c.name)}</h2><div class="tags">${[...new Set(ds.map(d => d.owner))].map(o => `<span class="tag" style="background:${OWNER_COLORS[o]?.bg || '#eee'};color:${OWNER_COLORS[o]?.text || '#333'}">${o}</span>`).join("")}</div></div><div class="actions"><button class="btn" onclick="openCustomer('${c.id}')">Edit customer</button><button class="btn primary" onclick="openDeal('${c.id}')">+ Add deal</button></div></div><div class="phone"><div class="field"><label>WhatsApp number</label><input value="${esc(c.phone)}" placeholder="923001234567" onchange="updatePhone('${c.id}',this.value)"></div></div><div class="metrics"><div class="metric"><label>Total tracked</label><strong>${money(s.total)}</strong></div><div class="metric"><label>Received</label><strong class="green">${money(s.got)}</strong></div><div class="metric"><label>Outstanding</label><strong class="amber">${money(s.out)}</strong></div><div class="metric"><label>Progress</label><strong>${s.pct}%</strong></div></div><div class="progress"><i style="width:${s.pct}%"></i></div></div>
  ${ds.map(d => `<div class="card truck"><div class="truck-head"><div><div class="truck-title">${esc(d.title)}</div><div class="truck-sub">Owner: ${esc(d.owner)} · Deal total: ${money(d.total)}</div></div><div class="actions"><button class="btn small" onclick="openDeal('${c.id}','${d.id}')">Edit deal</button><button class="btn small danger" onclick="deleteDeal('${d.id}')">Delete</button></div></div><div class="route">${DB.installments.filter(i => i.dealId === d.id).sort((a, b) => a.qist - b.qist).map(i => qbox({ ...i, deal: d, customer: c })).join("")}</div></div>`).join("") || '<div class="empty">No deals for this customer.</div>'}`,
    `<button class="btn" onclick="setView('customers')">← Customers</button>`);
}


// --- TRUCKS LOGISTICS VIEW ---
function trucksView() {
  const ts = DB.trucks || [];
  return layout("Trucks & Logistics", "Manage shipments and compute net margins",
    `<div class="grid">${ts.map(t => {
      // Calculate total cost (purchase + expenses) to display
      const totalCost = (Number(t.purchase_price) || 0) + (Number(t.expenses) || 0);
      
      return `<div class="card customer-card" onclick="openTruck('${t.id}')">
        <div class="row">
          <div><b>${esc(t.truck_number)}</b><div class="small muted">${t.cows_count || 0} cows</div></div>
        </div>
        <div class="metrics" style="margin-top:16px; gap: 15px;">
          <div class="metric"><label>Total Cost</label><strong>${money(totalCost)}</strong></div>
          <div class="metric"><label>Sales</label><strong class="green">${money(t.sale_price)}</strong></div>
          <div class="metric"><label>Net Margin</label><strong class="${t.profit >= 0 ? 'green' : 'red'}">${money(t.profit)}</strong></div>
        </div>
        <div class="actions" style="margin-top:16px">
          <button class="btn small" onclick="event.stopPropagation();openTruck('${t.id}')">Edit Truck</button>
          <button class="btn small danger" onclick="event.stopPropagation();deleteTruckRecord('${t.id}')">Delete</button>
        </div>
      </div>`;
    }).join("") || '<div class="empty">No truck shipments recorded yet.</div>'}</div>`,
    `<button class="btn primary" onclick="openTruck()">+ Add Truck</button>`);
}

function openTruck(id) {
  const t = id ? DB.trucks.find(x => x.id === id) : { truck_number: "", cows_count: "", purchase_price: "", sale_price: "", expenses: "" };
  
  openModal(`<h3>${id ? "Edit Shipment" : "Add New Truck"}</h3><div class="form-grid">
  <div class="field full"><label>Truck Number / Batch ID *</label><input id="tNum" value="${esc(t.truck_number)}" placeholder="e.g. TX-409"></div>
  <div class="field"><label>Total Cows</label><input id="tCows" type="number" value="${t.cows_count}"></div>
  <div class="field"><label>Purchase Price</label><input id="tPurch" type="number" value="${t.purchase_price}"></div>
  <div class="field"><label>Logistics / Expenses</label><input id="tExp" type="number" value="${t.expenses}"></div>
  <div class="field"><label>Total Sale Price</label><input id="tSale" type="number" value="${t.sale_price}"></div>
  </div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveTruck('${id || ""}')">Save Shipment</button></div>`);
}

async function saveTruck(id) {
  const truck_number = document.getElementById("tNum").value.trim();
  if (!truck_number) return alert("Truck Number/ID is required.");
  
  const truckObj = {
    id: id || uid("t"),
    truck_number,
    cows_count: Number(document.getElementById("tCows").value) || 0,
    purchase_price: Number(document.getElementById("tPurch").value) || 0,
    sale_price: Number(document.getElementById("tSale").value) || 0,
    expenses: Number(document.getElementById("tExp").value) || 0
  };

  try {
    await dbUpsertTruck(truckObj);
    await loadDataFromSupabase();
    closeModal();
    render();
    toast("Truck data secured");
  } catch (err) { alert("Save error: " + err.message); }
}

async function deleteTruckRecord(id) {
  if (!confirm("Permanently delete this truck's financial record?")) return;
  try {
    await dbDeleteTruck(id);
    await loadDataFromSupabase();
    render();
    toast("Truck deleted");
  } catch (err) { alert("Delete error: " + err.message); }
}

function allQists() {
  let xs = all();
  xs = xs.filter(i => STATE.filter === "all" || status(i) === STATE.filter);
  xs.sort((a, b) => a.due.localeCompare(b.due));
  const counts = { all: all().length, overdue: 0, soon: 0, paid: 0, future: 0 };
  all().forEach(i => counts[status(i)]++);

  return layout("All Qists", "Every installment, sortable by status",
    `<div class="filter">${Object.entries({ all: "All", overdue: "Overdue", soon: "Due soon", paid: "Paid", future: "Upcoming" }).map(([k, v]) => `<button class="chip ${STATE.filter === k ? "active" : ""}" onclick="setFilter('${k}')">${v} (${counts[k]})</button>`).join("")}</div><div class="qgrid">${xs.map(i => qbox(i)).join("") || '<div class="empty">No installments in this filter.</div>'}</div>`,
    `<button class="btn primary" onclick="openPayment()">+ Payment</button>`);
}

function openModal(content) { document.getElementById("modal").innerHTML = content; document.getElementById("modalBack").classList.add("show"); }
function closeModal() { document.getElementById("modalBack").classList.remove("show"); }
document.getElementById("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });

function openCustomer(id) {
  const c = id ? customer(id) : { name: "", phone: "", notes: "" };
  openModal(`<h3>${id ? "Edit customer" : "Add customer"}</h3><div class="form-grid">
  <div class="field"><label>Name *</label><input id="fName" value="${esc(c.name)}"></div>
  <div class="field"><label>WhatsApp</label><input id="fPhone" value="${esc(c.phone)}" placeholder="923001234567"></div>
  <div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(c.notes || "")}</textarea></div></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveCustomer('${id || ""}')">Save</button></div>`);
}

async function saveCustomer(id) {
  const name = document.getElementById("fName").value.trim();
  if (!name) return alert("Customer name is required.");
  const customerObj = {
    id: id || uid("c"),
    name,
    phone: document.getElementById("fPhone").value.replace(/\D/g, ""),
    notes: document.getElementById("fNotes").value
  };

  try {
    await dbUpsertCustomer(customerObj);
    await loadDataFromSupabase();
    if (!id) STATE.activeCustomer = customerObj.id;
    closeModal();
    render();
    toast("Customer saved to Supabase");
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

async function deleteCustomer(id) {
  if (!confirm("Delete this customer and all their deals/payments permanently?")) return;
  try {
    await dbDeleteCustomer(id);
    await loadDataFromSupabase();
    STATE.activeCustomer = null;
    render();
    toast("Customer deleted from cloud");
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

async function updatePhone(id, val) {
  const c = customer(id);
  c.phone = val.replace(/\D/g, "");
  await dbUpsertCustomer(c);
  toast("Phone updated");
}

function openDeal(cid, did) {
  const d = did ? deal(did) : { owner: "Self", title: "", total: "", created: new Date().toISOString().slice(0, 10) };
  const ins = did ? DB.installments.filter(i => i.dealId === did).sort((a, b) => a.qist - b.qist) : [];
  openModal(`<h3>${did ? "Edit deal" : "Add deal"}</h3><div class="form-grid">
  <div class="field"><label>Customer *</label><select id="dCust">${DB.customers.map(c => `<option value="${c.id}" ${(c.id === (cid || d.customerId)) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
  <div class="field"><label>Owner</label><select id="dOwner">${Object.keys(OWNER_COLORS).map(o => `<option ${d.owner === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
  <div class="field"><label>Deal title</label><input id="dTitle" value="${esc(d.title)}" placeholder="10 Aug 2026 · 12 items"></div>
  <div class="field"><label>Deal total</label><input id="dTotal" type="number" value="${d.total || ""}"></div>
  </div>
  <div class="section"><div class="section-head"><h3>Installments</h3><button class="btn small" onclick="addInstallmentRow()">+ Add qist</button></div><div id="instRows">${ins.map(rowHtml).join("")}</div></div>
  <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveDeal('${did || ""}')">Save deal</button></div>`);
}

function rowHtml(i = { qist: "", amount: "", due: "" }) {
  return `<div class="form-grid inst-row" style="margin-bottom:8px">
    <div class="field"><label>Qist</label><input class="iq" type="number" value="${i.qist}"></div>
    <div class="field"><label>Amount</label><input class="ia" type="number" value="${i.amount}"></div>
    <div class="field"><label>Due date</label><input class="idate" type="date" value="${i.due}"></div>
    <button class="btn small danger" style="align-self:end;height:38px" onclick="this.parentElement.remove()">Remove</button>
  </div>`;
}

function addInstallmentRow() {
  document.getElementById("instRows").insertAdjacentHTML("beforeend", rowHtml());
}

async function saveDeal(did) {
  const customerId = document.getElementById("dCust").value;
  const owner = document.getElementById("dOwner").value;
  const title = document.getElementById("dTitle").value.trim();
  const total = Number(document.getElementById("dTotal").value) || 0;
  const rows = [...document.querySelectorAll(".inst-row")].map(r => ({
    qist: Number(r.querySelector(".iq").value),
    amount: Number(r.querySelector(".ia").value),
    due: r.querySelector(".idate").value
  })).filter(x => x.qist && x.amount && x.due);

  if (!customerId || !title || !rows.length) return alert("Customer, deal title and at least one installment are required.");

  const dealId = did || uid("d");
  const dealObj = { id: dealId, customerId, owner, title, total, created: new Date().toISOString().slice(0, 10) };

  try {
    await dbUpsertDeal(dealObj, rows);
    await loadDataFromSupabase();
    STATE.activeCustomer = customerId;
    closeModal();
    render();
    toast("Deal saved to Supabase");
  } catch (err) {
    alert("Failed saving deal: " + err.message);
  }
}

async function deleteDeal(id) {
  if (!confirm("Delete this deal and all installment/payment records permanently?")) return;
  try {
    await dbDeleteDeal(id);
    await loadDataFromSupabase();
    render();
    toast("Deal deleted from cloud");
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

function openInstallment(id) {
  const i = DB.installments.find(x => x.id === id), p = paymentsFor(id);
  openModal(`<h3>Edit installment</h3><div class="form-grid">
  <div class="field"><label>Qist number</label><input id="eiq" type="number" value="${i.qist}"></div>
  <div class="field"><label>Amount</label><input id="eia" type="number" value="${i.amount}"></div>
  <div class="field"><label>Due date</label><input id="eid" type="date" value="${i.due}"></div>
  </div><div class="payment-list">${p.length ? `<b>Payment history</b>${p.map(x => `<div class="payment">${dateFmt(x.date)} · ${money(x.amount)} · ${esc(x.method || "Cash")} ${x.note ? "· " + esc(x.note) : ""}</div>`).join("")}` : "<span class='muted small'>No payments recorded.</span>"}</div>
  <div class="modal-actions"><button class="btn danger" onclick="deleteInstallment('${id}')">Delete</button><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveInstallment('${id}')">Save</button></div>`);
}

async function saveInstallment(id) {
  const qist = Number(document.getElementById("eiq").value);
  const amount = Number(document.getElementById("eia").value);
  const due = document.getElementById("eid").value;

  try {
    await dbUpdateInstallment(id, qist, amount, due);
    await loadDataFromSupabase();
    closeModal();
    render();
    toast("Installment updated in Supabase");
  } catch (err) {
    alert("Failed update: " + err.message);
  }
}

async function deleteInstallment(id) {
  if (!confirm("Delete this installment and all related payments?")) return;
  try {
    await dbDeleteInstallment(id);
    await loadDataFromSupabase();
    closeModal();
    render();
    toast("Installment deleted");
  } catch (err) {
    alert("Failed delete: " + err.message);
  }
}

function openPayment(id) {
  const i = id ? DB.installments.find(x => x.id === id) : null, xs = i ? [i] : DB.installments;
  openModal(`<h3>Record payment</h3><div class="form-grid">
  <div class="field full"><label>Installment *</label><select id="pInst">${xs.map(x => { const d = deal(x.dealId), c = customer(d?.customerId); return `<option value="${x.id}">${esc(c?.name)} · Qist ${x.qist} · ${money(x.amount)} · ${dateFmt(x.due)}</option>`; }).join("")}</select></div>
  <div class="field"><label>Amount received *</label><input id="pAmt" type="number" value="${i ? Math.max(0, i.amount - received(i.id)) : ""}"></div>
  <div class="field"><label>Payment date</label><input id="pDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
  <div class="field"><label>Method</label><select id="pMethod"><option>Cash</option><option>Bank transfer</option><option>Cheque</option><option>Other</option></select></div>
  <div class="field"><label>Reference</label><input id="pRef" placeholder="Optional"></div>
  </div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="savePayment()">Save payment</button></div>`);
}

async function savePayment() {
  const id = document.getElementById("pInst").value, i = DB.installments.find(x => x.id === id), amt = Number(document.getElementById("pAmt").value);
  if (!amt || amt <= 0) return alert("Enter a valid payment amount.");
  if (received(id) + amt > i.amount && !confirm("This payment exceeds the installment amount. Continue?")) return;

  const paymentObj = {
    id: uid("p"),
    installmentId: id,
    amount: amt,
    date: document.getElementById("pDate").value,
    method: document.getElementById("pMethod").value,
    note: document.getElementById("pRef").value.trim()
  };

  try {
    await dbInsertPayment(paymentObj);
    await loadDataFromSupabase();
    closeModal();
    render();
    toast("Payment recorded to cloud");
  } catch (err) {
    alert("Failed saving payment: " + err.message);
  }
}

function setFilter(f) { STATE.filter = f; STATE.view = "all"; render(); }
function setView(v) { STATE.view = v; STATE.activeCustomer = null; render(); }
function selectCustomer(id) { STATE.activeCustomer = id; STATE.view = "customers"; render(); }
function mobileNav() { document.querySelector(".sidebar").style.display = "flex"; }

async function syncCloud() {
  toast("Refreshing from Supabase...");
  await loadDataFromSupabase();
  render();
  toast("Database up to date");
}

document.querySelectorAll(".nav button").forEach(b => b.onclick = () => {
  STATE.view = b.dataset.view;
  STATE.activeCustomer = null;
  render();
});

document.getElementById("searchBox").oninput = e => { STATE.search = e.target.value; renderSidebar(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// App Init with Auth Check
(async function init() {
  // 1. Check if Supabase already remembers you (active session)
  const { data: { session } } = await dbClient.auth.getSession();

  if (session) {
    // 2a. You are logged in: Hide overlay and load data
    document.getElementById("loginOverlay").classList.add("hidden");
    await loadDataFromSupabase();
    render();
  } else {
    // 2b. Not logged in: Ensure login screen is visible
    document.getElementById("loginOverlay").classList.remove("hidden");
  }
})();





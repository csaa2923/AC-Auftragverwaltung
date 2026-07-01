const PASSWORD = "ACT2026";
const STORE_KEY = "act_management_center_v1";
const STATUSES = [
  "Anfrage eingegangen",
  "Angebot erstellt",
  "Angebot per WhatsApp versendet",
  "Kunde hat bestätigt",
  "Zahlung offen",
  "Zahlung erhalten",
  "Organisation läuft",
  "Reservierungen erledigt",
  "Auftrag abgeschlossen"
];
const SERVICES = [
  "Erleben & Entdecken",
  "Genuss & Kulinarik",
  "Ruhe & Wellness",
  "Familie & Kinder",
  "Romantik",
  "Kunst & Kultur",
  "Sport & Action",
  "Natur authentisch erleben",
  "Exklusive Services",
  "Gruppen & Events",
  "Transfer",
  "individuelle Programme"
];
const DEFAULT_TASKS = [
  "Hotel reservieren",
  "Restaurant reservieren",
  "Transfer organisieren",
  "Guide / Bergführer organisieren",
  "Skilehrer organisieren",
  "Wellness buchen",
  "Tickets buchen",
  "Blumen / Geschenk organisieren",
  "Rechnung vorbereiten",
  "Kunde informieren"
];
const WA_TEMPLATES = [
  "Anfragebestätigung",
  "Angebotsübermittlung",
  "verbindliche Beauftragung durch Kunde",
  "Zahlungsaufforderung",
  "Zahlungserinnerung",
  "Buchungsbestätigung",
  "Tagesprogramm",
  "Feedback-Anfrage"
];

let state = loadState();
let selectedId = state.selectedId || (state.orders[0] && state.orders[0].id);

function money(value) {
  return Number(value || 0).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function get(obj, path) {
  return path.split(".").reduce((acc, key) => acc && acc[key], obj);
}
function set(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((acc, key) => acc[key], obj);
  target[last] = value;
}
function makeOrder(sequence = 1) {
  const next = sequence.toString().padStart(4, "0");
  return {
    id: uid(),
    createdAt: today(),
    status: "Anfrage eingegangen",
    customer: { name: "", phone: "", email: "", hotel: "", stay: "", language: "Deutsch", guests: 2, type: "Standard", wishes: "", notes: "" },
    offer: { number: `ACT-${new Date().getFullYear()}-${next}`, validUntil: "", paymentModel: "100 % Vorauszahlung", paymentLink: "", paymentStatus: "Zahlung offen", items: [] },
    program: [],
    tasks: DEFAULT_TASKS.map(title => ({ id: uid(), title, done: false }))
  };
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.orders)) return saved;
  } catch {}
  const first = makeOrder(1);
  first.customer.name = "Neue Anfrage";
  return { selectedId: first.id, orders: [first] };
}
function saveState() {
  state.selectedId = selectedId;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  render();
}
function persistState() {
  state.selectedId = selectedId;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function order() {
  return state.orders.find(item => item.id === selectedId) || state.orders[0];
}
function total(orderData = order()) {
  return orderData.offer.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
}
function applyAutomaticStatus(reason) {
  const current = order();
  if (reason === "offer" && STATUSES.indexOf(current.status) < 1) current.status = "Angebot erstellt";
  if (reason === "sent" && STATUSES.indexOf(current.status) < 2) current.status = "Angebot per WhatsApp versendet";
  if (reason === "confirmed") current.status = "Zahlung offen";
  if (reason === "paid") current.status = "Organisation läuft";
  if (reason === "tasks" && current.tasks.length && current.tasks.every(task => task.done)) {
    current.status = current.status === "Organisation läuft" ? "Reservierungen erledigt" : current.status;
  }
}
function statusClass(status) {
  if (status.includes("abgeschlossen") || status.includes("erhalten") || status.includes("erledigt")) return "ok";
  if (status.includes("WhatsApp") || status.includes("Organisation")) return "info";
  return "";
}

function initAuth() {
  const unlocked = sessionStorage.getItem("act_cmc_unlocked") === "1";
  document.body.classList.toggle("locked", !unlocked);
  document.getElementById("authScreen").style.display = unlocked ? "none" : "flex";
  document.getElementById("authForm").addEventListener("submit", event => {
    event.preventDefault();
    if (document.getElementById("authPassword").value.trim() === PASSWORD) {
      sessionStorage.setItem("act_cmc_unlocked", "1");
      document.body.classList.remove("locked");
      document.getElementById("authScreen").style.display = "none";
    } else {
      document.getElementById("authError").textContent = "Passwort ist nicht korrekt.";
      document.getElementById("authPassword").select();
    }
  });
  document.getElementById("lockButton").addEventListener("click", () => {
    sessionStorage.removeItem("act_cmc_unlocked");
    location.reload();
  });
}

function initEvents() {
  document.querySelectorAll(".tabs button").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  document.getElementById("newOrderButton").addEventListener("click", () => {
    const next = makeOrder(state.orders.length + 1);
    state.orders.unshift(next);
    selectedId = next.id;
    saveState();
    showTab("customer");
  });
  document.getElementById("saveButton").addEventListener("click", saveState);
  document.getElementById("searchOrders").addEventListener("input", renderOrders);
  document.getElementById("addItemButton").addEventListener("click", () => {
    order().offer.items.push({ id: uid(), service: SERVICES[0], description: "", qty: 1, price: 0 });
    applyAutomaticStatus("offer");
    saveState();
  });
  document.getElementById("addProgramButton").addEventListener("click", () => {
    order().program.push({ id: uid(), date: today(), time: "", title: "", place: "", description: "", contact: "", cost: "", note: "" });
    saveState();
  });
  document.getElementById("addTaskButton").addEventListener("click", () => {
    order().tasks.push({ id: uid(), title: "Neue Aufgabe", done: false });
    saveState();
  });
  document.getElementById("waTemplate").addEventListener("change", renderWhatsApp);
  document.getElementById("copyWaButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById("waText").value);
  });
  document.getElementById("markOfferSentButton").addEventListener("click", () => { applyAutomaticStatus("sent"); saveState(); });
  document.getElementById("markConfirmedButton").addEventListener("click", () => { applyAutomaticStatus("confirmed"); saveState(); });
  document.querySelector('select[data-field="offer.paymentStatus"]').addEventListener("change", event => {
    order().offer.paymentStatus = event.target.value;
    if (event.target.value === "Zahlung erhalten") applyAutomaticStatus("paid");
    persistState();
    renderSoft();
  });
  document.getElementById("printOfferButton").addEventListener("click", () => printTarget("print-offer"));
  document.getElementById("printProgramButton").addEventListener("click", () => printTarget("print-program"));
  document.getElementById("exportButton").addEventListener("click", exportJson);
  document.getElementById("importFile").addEventListener("change", importJson);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleInput);
  document.addEventListener("click", handleClick);
}
function printTarget(className) {
  document.body.classList.add(className);
  window.print();
  setTimeout(() => document.body.classList.remove(className), 300);
}
function showTab(id) {
  document.querySelectorAll(".tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.toggle("active", panel.id === id));
  render();
}
function openOrderTab(id, tabName) {
  selectedId = id;
  persistState();
  showTab(tabName || "customer");
}
function handleInput(event) {
  const field = event.target.dataset.field;
  const row = event.target.closest("[data-kind]");
  if (field) {
    set(order(), field, event.target.type === "number" ? Number(event.target.value) : event.target.value);
    if (field.startsWith("offer.")) applyAutomaticStatus("offer");
    if (field === "offer.paymentStatus" && event.target.value === "Zahlung erhalten") applyAutomaticStatus("paid");
    persistState();
    renderSoft();
  }
  if (row) {
    updateRow(row, event.target);
    persistState();
    renderSoft();
  }
}
function handleClick(event) {
  const trigger = event.target.closest("[data-action]");
  const action = trigger && trigger.dataset.action;
  if (!action) return;
  const id = trigger.dataset.id;
  if (action === "select") {
    openOrderTab(id, trigger.dataset.tabTarget || "customer");
    return;
  }
  if (action === "deleteItem") order().offer.items = order().offer.items.filter(item => item.id !== id);
  if (action === "deleteProgram") order().program = order().program.filter(item => item.id !== id);
  if (action === "deleteTask") order().tasks = order().tasks.filter(item => item.id !== id);
  saveState();
}
function updateRow(row, target) {
  const current = order();
  const collection = row.dataset.kind === "offer.items" ? current.offer.items : current[row.dataset.kind];
  const item = collection.find(entry => entry.id === row.dataset.id);
  if (!item) return;
  item[target.dataset.key] = target.type === "checkbox" ? target.checked : (target.type === "number" ? Number(target.value) : target.value);
  if (row.dataset.kind === "offer.items") applyAutomaticStatus("offer");
  if (row.dataset.kind === "tasks") applyAutomaticStatus("tasks");
}

function render() {
  if (!order()) return;
  renderForms();
  renderDashboard();
  renderOrders();
  renderItems();
  renderOfferPreview();
  renderWhatsApp();
  renderProgram();
  renderTasks();
  document.getElementById("backupInfo").textContent = `${state.orders.length} Auftrag/Aufträge lokal gespeichert.\nLetzte Speicherung: ${new Date().toLocaleString("de-AT")}`;
}
function renderSoft() {
  renderStatusControl();
  renderDashboard();
  renderOrders();
  renderOfferPreview();
  renderWhatsApp();
  renderProgramPreview();
  document.getElementById("totalPrice").textContent = money(total());
  document.getElementById("backupInfo").textContent = `${state.orders.length} Auftrag/Aufträge lokal gespeichert.\nLetzte Speicherung: ${new Date().toLocaleString("de-AT")}`;
}
function renderForms() {
  const current = order();
  document.querySelectorAll("[data-field]").forEach(input => {
    if (document.activeElement === input) return;
    input.value = get(current, input.dataset.field) ?? "";
  });
  renderStatusControl();
}
function renderStatusControl() {
  const current = order();
  document.getElementById("statusSelect").innerHTML = STATUSES.map(status => `<option ${status === current.status ? "selected" : ""}>${status}</option>`).join("");
}
function renderDashboard() {
  const revenue = state.orders.filter(item => ["Zahlung erhalten", "Organisation läuft", "Reservierungen erledigt", "Auftrag abgeschlossen"].includes(item.status)).reduce((sum, item) => sum + total(item), 0);
  const stats = [
    ["Neue Anfragen", count("Anfrage eingegangen")],
    ["Erstellte Angebote", count("Angebot erstellt")],
    ["Bestätigte Angebote", count("Kunde hat bestätigt") + count("Zahlung offen")],
    ["Offene Zahlungen", state.orders.filter(item => item.offer.paymentStatus === "Zahlung offen" && STATUSES.indexOf(item.status) >= 3).length],
    ["Laufende Aufträge", count("Organisation läuft") + count("Reservierungen erledigt")],
    ["Abgeschlossen", count("Auftrag abgeschlossen")],
    ["Monatsumsatz", money(revenue)],
    ["Gesamt", state.orders.length]
  ];
  document.getElementById("dashboardCards").innerHTML = stats.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("recentOrders").innerHTML = state.orders.slice(0, 6).map(orderCard).join("");
  document.getElementById("statusFlow").innerHTML = STATUSES.map(status => `<li>${status}</li>`).join("");
}
function count(status) {
  return state.orders.filter(item => item.status === status).length;
}
function renderOrders() {
  const query = (document.getElementById("searchOrders").value || "").toLowerCase();
  const filtered = state.orders.filter(item => JSON.stringify([item.customer.name, item.customer.hotel, item.offer.number, item.status]).toLowerCase().includes(query));
  document.getElementById("orderList").innerHTML = filtered.map(orderCard).join("") || `<p class="muted">Keine Aufträge gefunden.</p>`;
}
function orderCard(item) {
  return `<article class="order-card">
    <div class="order-main">
      <strong>${esc(item.customer.name || "Neue Anfrage")}</strong>
      <small>${esc(item.offer.number)} · ${esc(item.customer.hotel || "ohne Unterkunft")} · ${money(total(item))}</small>
      <small>${esc(item.customer.phone || "keine WhatsApp-Nummer")} · ${esc(item.customer.stay || "kein Zeitraum")}</small>
    </div>
    <div class="order-tools">
      <span class="pill ${statusClass(item.status)}">${esc(item.status)}</span>
      <button class="small ghost" data-action="select" data-tab-target="customer" data-id="${item.id}" onclick="openOrderTab('${item.id}','customer')" type="button">Kunde</button>
      <button class="small ghost" data-action="select" data-tab-target="offer" data-id="${item.id}" onclick="openOrderTab('${item.id}','offer')" type="button">Angebot</button>
      <button class="small ghost" data-action="select" data-tab-target="whatsapp" data-id="${item.id}" onclick="openOrderTab('${item.id}','whatsapp')" type="button">WhatsApp</button>
      <button class="small ghost" data-action="select" data-tab-target="program" data-id="${item.id}" onclick="openOrderTab('${item.id}','program')" type="button">Programm</button>
      <button class="small ghost" data-action="select" data-tab-target="tasks" data-id="${item.id}" onclick="openOrderTab('${item.id}','tasks')" type="button">Aufgaben</button>
    </div>
  </article>`;
}
function renderItems() {
  const rows = order().offer.items.map(item => `<div class="item-row" data-kind="offer.items" data-id="${item.id}">
    <select data-key="service">${SERVICES.map(service => `<option ${service === item.service ? "selected" : ""}>${service}</option>`).join("")}</select>
    <input data-key="description" value="${esc(item.description)}" placeholder="Beschreibung">
    <input data-key="qty" type="number" min="0" step="1" value="${item.qty}">
    <input data-key="price" type="number" min="0" step="0.01" value="${item.price}">
    <button class="ghost small" data-action="deleteItem" data-id="${item.id}" type="button">×</button>
  </div>`).join("");
  document.getElementById("itemsEditor").innerHTML = rows || `<p class="muted">Noch keine Position. Über „Position hinzufügen“ starten.</p>`;
  document.getElementById("totalPrice").textContent = money(total());
}
function renderOfferPreview() {
  const current = order();
  const items = current.offer.items.map(item => `<tr><td>${esc(item.service)}<br><small>${esc(item.description)}</small></td><td>${item.qty}</td><td>${money(item.price)}</td><td>${money(item.qty * item.price)}</td></tr>`).join("");
  document.getElementById("offerPreview").innerHTML = `
    <p><strong>Angebotsnummer:</strong> ${esc(current.offer.number)}<br><strong>Kunde:</strong> ${esc(current.customer.name)}<br><strong>Gültig bis:</strong> ${esc(current.offer.validUntil || "nach Vereinbarung")}</p>
    <table class="preview-table"><thead><tr><th>Leistung</th><th>Menge</th><th>Preis</th><th>Summe</th></tr></thead><tbody>${items || `<tr><td colspan="4">Noch keine Position erfasst.</td></tr>`}</tbody></table>
    <h3>Gesamt: ${money(total())}</h3>
    <p><strong>Zahlungsmodell:</strong> ${esc(current.offer.paymentModel)}<br><strong>Zahlungslink:</strong> ${esc(current.offer.paymentLink || "wird separat übermittelt")}</p>
    <p class="legal-note">Die Anfrage ist unverbindlich. Die Buchung wird erst nach ausdrücklicher Kundenbestätigung und Zahlung verbindlich. Die Organisation beginnt nach Zahlungseingang. Storno- und Zahlungsbedingungen: Bereits verbindlich gebuchte Drittleistungen können nach den Bedingungen des jeweiligen Leistungsträgers kostenpflichtig sein.</p>`;
}
function renderWhatsApp() {
  const select = document.getElementById("waTemplate");
  if (!select.innerHTML) select.innerHTML = WA_TEMPLATES.map(name => `<option>${name}</option>`).join("");
  const text = whatsappText(select.value || WA_TEMPLATES[0]);
  const phone = order().customer.phone.replace(/\D/g, "");
  const link = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : "";
  document.getElementById("waText").value = text;
  document.getElementById("waLink").value = link;
  document.getElementById("openWaButton").href = link || "#";
}
function whatsappText(type) {
  const current = order();
  const lang = current.customer.language;
  const name = current.customer.name || "Vielen Dank";
  const amount = money(total());
  const number = current.offer.number;
  const pay = current.offer.paymentLink || "[Zahlungslink]";
  const dictionaries = {
    Deutsch: {
      "Anfragebestätigung": `Guten Tag ${name}, vielen Dank für Ihre Anfrage bei Alpine Concierge Tirol. Ihre Anfrage ist unverbindlich. Wir prüfen die Verfügbarkeit und melden uns mit einem passenden Angebot.`,
      "Angebotsübermittlung": `Guten Tag ${name}, gerne übermitteln wir Ihnen Angebot ${number} über ${amount}. Die Buchung wird erst nach Ihrer ausdrücklichen Bestätigung und Zahlung verbindlich.`,
      "verbindliche Beauftragung durch Kunde": `JA, ich beauftrage Alpine Concierge Tirol gemäß Angebot ${number} zum Preis von ${amount}. Mir ist bekannt, dass die Organisation erst nach Zahlungseingang startet.`,
      "Zahlungsaufforderung": `Guten Tag ${name}, vielen Dank für Ihre Bestätigung. Bitte nutzen Sie folgenden Zahlungslink: ${pay}. Nach Zahlungseingang starten wir mit der Organisation.`,
      "Zahlungserinnerung": `Guten Tag ${name}, kurze Erinnerung: Für Angebot ${number} ist die Zahlung noch offen. Die Organisation beginnt nach Zahlungseingang. Zahlungslink: ${pay}`,
      "Buchungsbestätigung": `Guten Tag ${name}, wir bestätigen den Zahlungseingang und die verbindliche Buchung zu Angebot ${number}. Die Organisation läuft nun.`,
      "Tagesprogramm": `Guten Tag ${name}, hier ist Ihr Tagesprogramm zu Angebot ${number}:\n\n${programPlain()}`,
      "Feedback-Anfrage": `Guten Tag ${name}, wir hoffen, Sie hatten ein wunderbares Erlebnis mit Alpine Concierge Tirol. Über ein kurzes Feedback würden wir uns sehr freuen.`
    },
    Englisch: {
      "Anfragebestätigung": `Hello ${name}, thank you for contacting Alpine Concierge Tirol. Your request is non-binding. We will check availability and send a suitable offer.`,
      "Angebotsübermittlung": `Hello ${name}, please find offer ${number} for ${amount}. The booking becomes binding only after your explicit confirmation and payment.`,
      "verbindliche Beauftragung durch Kunde": `YES, I commission Alpine Concierge Tirol according to offer ${number} at the price of ${amount}. I understand that organization starts only after payment has been received.`,
      "Zahlungsaufforderung": `Hello ${name}, thank you for your confirmation. Please use this payment link: ${pay}. We will start organizing after payment has been received.`,
      "Zahlungserinnerung": `Hello ${name}, a short reminder: payment for offer ${number} is still open. Organization starts after payment. Payment link: ${pay}`,
      "Buchungsbestätigung": `Hello ${name}, we confirm receipt of payment and the binding booking for offer ${number}. Organization is now in progress.`,
      "Tagesprogramm": `Hello ${name}, this is your daily program for offer ${number}:\n\n${programPlain()}`,
      "Feedback-Anfrage": `Hello ${name}, we hope you enjoyed your Alpine Concierge Tirol experience. We would be delighted to receive your feedback.`
    },
    Italienisch: {
      "Anfragebestätigung": `Buongiorno ${name}, grazie per la richiesta ad Alpine Concierge Tirol. La richiesta non è vincolante. Verifichiamo la disponibilità e inviamo un'offerta adeguata.`,
      "Angebotsübermittlung": `Buongiorno ${name}, inviamo l'offerta ${number} di ${amount}. La prenotazione diventa vincolante solo dopo conferma esplicita e pagamento.`,
      "verbindliche Beauftragung durch Kunde": `SÌ, incarico Alpine Concierge Tirol secondo l'offerta ${number} al prezzo di ${amount}. Comprendo che l'organizzazione inizia solo dopo la ricezione del pagamento.`,
      "Zahlungsaufforderung": `Buongiorno ${name}, grazie per la conferma. Utilizzi questo link di pagamento: ${pay}. Inizieremo l'organizzazione dopo la ricezione del pagamento.`,
      "Zahlungserinnerung": `Buongiorno ${name}, breve promemoria: il pagamento per l'offerta ${number} è ancora aperto. L'organizzazione inizia dopo il pagamento. Link: ${pay}`,
      "Buchungsbestätigung": `Buongiorno ${name}, confermiamo la ricezione del pagamento e la prenotazione vincolante per l'offerta ${number}. L'organizzazione è ora in corso.`,
      "Tagesprogramm": `Buongiorno ${name}, ecco il programma giornaliero per l'offerta ${number}:\n\n${programPlain()}`,
      "Feedback-Anfrage": `Buongiorno ${name}, speriamo che l'esperienza con Alpine Concierge Tirol sia stata splendida. Saremo felici di ricevere un breve feedback.`
    }
  };
  return dictionaries[lang][type];
}
function programPlain() {
  return sortedProgram().map(item => `${item.date || ""} ${item.time || ""} - ${item.title || "Programmpunkt"} (${item.place || "Ort folgt"})`).join("\n");
}
function sortedProgram() {
  return [...order().program].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
function renderProgram() {
  document.getElementById("programEditor").innerHTML = order().program.map(item => `<div class="program-row" data-kind="program" data-id="${item.id}">
    <input data-key="date" type="date" value="${esc(item.date)}">
    <input data-key="time" type="time" value="${esc(item.time)}">
    <input data-key="title" value="${esc(item.title)}" placeholder="Titel">
    <input data-key="place" value="${esc(item.place)}" placeholder="Ort">
    <button class="ghost small" data-action="deleteProgram" data-id="${item.id}" type="button">×</button>
    <textarea data-key="description" placeholder="Beschreibung">${esc(item.description)}</textarea>
    <input data-key="contact" value="${esc(item.contact)}" placeholder="Ansprechpartner">
    <input data-key="cost" value="${esc(item.cost)}" placeholder="Kostenhinweis optional">
    <textarea data-key="note" placeholder="Interne Notiz">${esc(item.note)}</textarea>
  </div>`).join("") || `<p class="muted">Noch keine Programmpunkte erfasst.</p>`;
  renderProgramPreview();
}
function renderProgramPreview() {
  document.getElementById("programPreview").innerHTML = sortedProgram().map(item => `<section><h3>${esc(item.date)} · ${esc(item.time || "nach Vereinbarung")}</h3><p><strong>${esc(item.title || "Programmpunkt")}</strong><br>${esc(item.place)}<br>${esc(item.description)}</p><p><small>${esc(item.contact)} ${item.cost ? "· " + esc(item.cost) : ""}</small></p></section>`).join("") || `<p>Noch kein Tagesprogramm erfasst.</p>`;
}
function renderTasks() {
  document.getElementById("taskList").innerHTML = order().tasks.map(task => `<div class="task-row ${task.done ? "done" : ""}" data-kind="tasks" data-id="${task.id}">
    <input data-key="done" type="checkbox" ${task.done ? "checked" : ""}>
    <input data-key="title" type="text" value="${esc(task.title)}">
    <button class="ghost small" data-action="deleteTask" data-id="${task.id}" type="button">×</button>
  </div>`).join("");
}
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `act-management-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  if (!data.orders || !Array.isArray(data.orders)) throw new Error("Ungültige JSON-Datei");
  state = data;
  selectedId = state.selectedId || state.orders[0].id;
  saveState();
  event.target.value = "";
}

initAuth();
initEvents();
render();

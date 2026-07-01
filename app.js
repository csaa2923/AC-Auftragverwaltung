import {
  completeGoogleRedirectSignIn,
  getCurrentFirebaseUser,
  onFirebaseUserChanged,
  signInFirebaseAnonymously,
  signInFirebaseWithGoogle,
  signOutFirebaseUser
} from "./firebase-auth.js";
import { firebaseAccessDeniedMessage, isAllowedFirebaseUser } from "./firebase-access.js";
import { getCloudUserId, initCloudStore, saveCloudState, stopCloudStore } from "./firebase-service.js";

const STORE_KEY = "act_management_center_v1";
const SESSION_KEY = "act_cmc_google_unlocked_v2";
const PREVIOUS_SESSION_KEY = "act_cmc_google_unlocked";
const LEGACY_SESSION_KEY = "act_cmc_unlocked";
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
const TASK_CATEGORIES = [
  "Angebot",
  "Programm",
  "Zahlungslink gesendet",
  "Zahlung eingegangen",
  "Reservierung",
  "Kunde informiert",
  "Rechnung",
  "Sonstiges"
];
const MILESTONES = [
  ["customer", "Kundendaten vollständig"],
  ["offer", "Angebot erstellt"],
  ["offerSent", "Angebot gesendet"],
  ["confirmed", "Kunde bestätigt"],
  ["paymentLinkSent", "Zahlungslink gesendet"],
  ["paymentReceived", "Zahlung eingegangen"],
  ["program", "Programm zusammengestellt"],
  ["tasksDone", "Aufgaben erledigt"],
  ["completed", "Auftrag abgeschlossen"]
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
let cloudReady = false;
let cloudConnecting = false;
let applyingRemoteState = false;

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
    hidden: false,
    status: "Anfrage eingegangen",
    customer: { name: "", phone: "", email: "", hotel: "", stay: "", language: "Deutsch", guests: 2, type: "Standard", wishes: "", notes: "" },
    offer: { number: `ACT-${new Date().getFullYear()}-${next}`, validUntil: "", paymentModel: "100 % Vorauszahlung", paymentLink: "", paymentStatus: "Zahlung offen", items: [] },
    program: [],
    milestones: Object.fromEntries(MILESTONES.map(([key]) => [key, false])),
    tasks: DEFAULT_TASKS.map(title => ({ id: uid(), title, category: "Reservierung", done: false }))
  };
}
function normalizeOrder(item) {
  item.milestones = { ...Object.fromEntries(MILESTONES.map(([key]) => [key, false])), ...(item.milestones || {}) };
  item.hidden = Boolean(item.hidden);
  item.tasks = (item.tasks || []).map(task => ({ category: "Sonstiges", done: false, ...task }));
  item.program = item.program || [];
  item.offer = item.offer || { number: `ACT-${new Date().getFullYear()}-0001`, validUntil: "", paymentModel: "100 % Vorauszahlung", paymentLink: "", paymentStatus: "Zahlung offen", items: [] };
  item.offer.items = item.offer.items || [];
  return item;
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.orders)) {
      saved.orders = saved.orders.map(normalizeOrder);
      return saved;
    }
  } catch {}
  const first = makeOrder(1);
  first.customer.name = "Neue Anfrage";
  return { selectedId: first.id, orders: [first] };
}
function normalizeAppState(nextState) {
  if (!nextState || !Array.isArray(nextState.orders)) return loadState();
  nextState.orders = nextState.orders.map(normalizeOrder);
  if (!nextState.orders.length) nextState.orders.push(makeOrder(1));
  nextState.selectedId = nextState.selectedId || nextState.orders[0].id;
  return nextState;
}
function saveState() {
  state.selectedId = selectedId;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (!applyingRemoteState) saveCloudState(state);
  render();
}
function persistState() {
  state.selectedId = selectedId;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (!applyingRemoteState) saveCloudState(state);
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
  if (reason === "offer") current.milestones.offer = true;
  if (reason === "sent" && STATUSES.indexOf(current.status) < 2) current.status = "Angebot per WhatsApp versendet";
  if (reason === "sent") current.milestones.offerSent = true;
  if (reason === "confirmed") current.status = "Zahlung offen";
  if (reason === "confirmed") current.milestones.confirmed = true;
  if (reason === "paymentLink") current.milestones.paymentLinkSent = true;
  if (reason === "paid") current.status = "Organisation läuft";
  if (reason === "paid") current.milestones.paymentReceived = true;
  if (reason === "program" && current.program.length) current.milestones.program = true;
  if (reason === "tasks" && current.tasks.length && current.tasks.every(task => task.done)) {
    current.status = current.status === "Organisation läuft" ? "Reservierungen erledigt" : current.status;
    current.milestones.tasksDone = true;
  }
}
function statusClass(status) {
  if (status.includes("abgeschlossen") || status.includes("erhalten") || status.includes("erledigt")) return "ok";
  if (status.includes("WhatsApp") || status.includes("Organisation")) return "info";
  return "";
}
function progressSteps(item) {
  const statusIndex = STATUSES.indexOf(item.status);
  const doneTasks = item.tasks.filter(task => task.done).length;
  const m = item.milestones || {};
  return [
    ["Kunde", m.customer || Boolean(item.customer.name && item.customer.phone)],
    ["Angebot", m.offer || item.offer.items.length > 0 || statusIndex >= 1],
    ["Angebot gesendet", m.offerSent || statusIndex >= 2],
    ["Bestätigt", m.confirmed || statusIndex >= 3],
    ["Link gesendet", m.paymentLinkSent],
    ["Zahlung", m.paymentReceived || item.offer.paymentStatus === "Zahlung erhalten" || statusIndex >= 5],
    [`Programm ${item.program.length}`, m.program || item.program.length > 0],
    [`Aufgaben ${doneTasks}/${item.tasks.length}`, m.tasksDone || (item.tasks.length > 0 && doneTasks === item.tasks.length)]
  ];
}

function unlockApp() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PREVIOUS_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  document.body.classList.remove("locked");
  document.getElementById("authScreen").style.display = "none";
}
function lockApp() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PREVIOUS_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  document.body.classList.add("locked");
  document.getElementById("authScreen").style.display = "flex";
}
function setAuthError(message) {
  document.getElementById("authError").textContent = message || "";
}
async function enforceAllowedUser(user) {
  if (isAllowedFirebaseUser(user)) return true;
  const message = firebaseAccessDeniedMessage(user);
  stopCloudStore();
  cloudReady = false;
  cloudConnecting = false;
  await signOutFirebaseUser();
  lockApp();
  setAuthError(message);
  setSyncStatus({ mode: "local", message });
  return false;
}
function firebaseLoginErrorMessage(error) {
  const code = error?.code || "unbekannter Fehler";
  if (code === "auth/unauthorized-domain") {
    return "Google Login blockiert: Diese Domain ist in Firebase nicht freigegeben. Bitte localhost/Vercel-Domain in Firebase Authorized domains eintragen.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google Login wurde geschlossen. Bitte erneut versuchen und das Google-Fenster abschliessen.";
  }
  return `Google Login fehlgeschlagen (${code}). Bitte Firebase-Einstellungen pruefen.`;
}
function ensureGoogleAuthOrigin() {
  if (location.protocol === "file:") {
    setAuthError("Google Login funktioniert nicht direkt per Datei. Bitte http://localhost:48731/index.html oeffnen.");
    setSyncStatus({ mode: "local", message: "Bitte ueber localhost oder Vercel oeffnen." });
    return false;
  }
  if (location.hostname === "127.0.0.1") {
    setAuthError("Wechsle auf localhost, weil Firebase Google Login dort zuverlaessiger erlaubt.");
    location.href = `http://localhost:${location.port || "48731"}${location.pathname}${location.search}${location.hash}`;
    return false;
  }
  return true;
}
function initAuth() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem(PREVIOUS_SESSION_KEY);
  document.body.classList.add("locked");
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("authForm").addEventListener("submit", event => event.preventDefault());
  document.getElementById("authGoogleLoginButton").addEventListener("click", async () => {
    setAuthError("");
    if (!ensureGoogleAuthOrigin()) return;
    setSyncStatus({ mode: "local", message: "Google Login wird gestartet ..." });
    try {
      const user = await signInFirebaseWithGoogle({ forceAccountSelection: true });
      if (user && await enforceAllowedUser(user)) unlockApp();
    } catch (error) {
      console.warn("Google Login fehlgeschlagen.", error);
      const message = firebaseLoginErrorMessage(error);
      setAuthError(message);
      setSyncStatus({ mode: "local", message });
    }
  });
  document.getElementById("authAnonymousLoginButton").addEventListener("click", async () => {
    if (!confirm("Testmodus starten? Dieser Modus ist nur fuer Tests gedacht und synchronisiert nicht automatisch mit deinen anderen Geraeten.")) return;
    setAuthError("");
    setSyncStatus({ mode: "local", message: "Testmodus wird gestartet ..." });
    try {
      const user = await signInFirebaseAnonymously();
      if (user && await enforceAllowedUser(user)) unlockApp();
    } catch (error) {
      console.warn("Testmodus fehlgeschlagen.", error);
      setAuthError("Testmodus fehlgeschlagen. Anonymous Auth pruefen.");
      setSyncStatus({ mode: "local", message: "Testmodus fehlgeschlagen. Anonymous Auth pruefen." });
    }
  });
  document.getElementById("lockButton").addEventListener("click", async () => {
    stopCloudStore();
    cloudReady = false;
    cloudConnecting = false;
    await signOutFirebaseUser();
    renderCloudUser(null);
    lockApp();
    setSyncStatus({ mode: "local", message: "Abgemeldet. Bitte mit Google anmelden." });
  });
}

function initEvents() {
  document.addEventListener("pointerdown", event => {
    const button = event.target.closest("button, .button");
    if (!button) return;
    button.classList.add("pressed");
  });
  document.addEventListener("pointerup", event => {
    const button = event.target.closest("button, .button");
    if (!button) return;
    setTimeout(() => button.classList.remove("pressed"), 120);
  });
  document.addEventListener("pointercancel", () => {
    document.querySelectorAll(".pressed").forEach(button => button.classList.remove("pressed"));
  });
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
  document.getElementById("googleLoginButton").addEventListener("click", async () => {
    if (!ensureGoogleAuthOrigin()) return;
    setSyncStatus({ mode: "local", message: "Google Login wird gestartet ..." });
    try {
      const user = await signInFirebaseWithGoogle({ forceAccountSelection: true });
      if (user) await enforceAllowedUser(user);
    } catch (error) {
      console.warn("Google Login fehlgeschlagen.", error);
      setSyncStatus({ mode: "local", message: firebaseLoginErrorMessage(error) });
    }
  });
  document.getElementById("anonymousLoginButton").addEventListener("click", async () => {
    if (!confirm("Testmodus starten? Dieser Modus ist nur fuer Tests gedacht und synchronisiert nicht automatisch mit deinen anderen Geraeten.")) return;
    setSyncStatus({ mode: "local", message: "Testmodus wird gestartet ..." });
    try {
      await signInFirebaseAnonymously();
    } catch (error) {
      console.warn("Testmodus fehlgeschlagen.", error);
      setSyncStatus({ mode: "local", message: "Testmodus fehlgeschlagen. Anonymous Auth pruefen." });
    }
  });
  document.getElementById("cloudLogoutButton").addEventListener("click", async () => {
    stopCloudStore();
    cloudReady = false;
    cloudConnecting = false;
    await signOutFirebaseUser();
    renderCloudUser(null);
    lockApp();
    setSyncStatus({ mode: "local", message: "Abgemeldet. Bitte mit Google anmelden." });
  });
  document.getElementById("saveButton").addEventListener("click", saveState);
  document.getElementById("searchOrders").addEventListener("input", renderOrders);
  document.getElementById("showHiddenOrders").addEventListener("change", () => {
    renderDashboard();
    renderOrders();
  });
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
    order().tasks.push({ id: uid(), title: "Neue Aufgabe", category: "Sonstiges", done: false });
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
    const value = event.target.type === "checkbox" ? event.target.checked : (event.target.type === "number" ? Number(event.target.value) : event.target.value);
    set(order(), field, value);
    if (field.startsWith("offer.")) applyAutomaticStatus("offer");
    if (field === "offer.paymentStatus" && event.target.value === "Zahlung erhalten") applyAutomaticStatus("paid");
    if (field === "offer.paymentLink" && event.target.value.trim()) applyAutomaticStatus("paymentLink");
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
  if (action === "hideOrder") {
    const item = state.orders.find(entry => entry.id === id);
    if (item) item.hidden = true;
    if (selectedId === id) selectedId = state.orders.find(entry => !entry.hidden && entry.id !== id)?.id || state.orders.find(entry => entry.id !== id)?.id;
    saveState();
    return;
  }
  if (action === "restoreOrder") {
    const item = state.orders.find(entry => entry.id === id);
    if (item) item.hidden = false;
    selectedId = id;
    saveState();
    return;
  }
  if (action === "deleteOrder") {
    const item = state.orders.find(entry => entry.id === id);
    const label = item?.customer?.name || item?.offer?.number || "diesen Kunden";
    if (!confirm(`${label} wirklich dauerhaft löschen? Diese Daten werden aus dem Browser-Speicher entfernt.`)) return;
    state.orders = state.orders.filter(entry => entry.id !== id);
    if (!state.orders.length) state.orders.push(makeOrder(1));
    selectedId = state.orders[0].id;
    saveState();
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
  if (row.dataset.kind === "program") applyAutomaticStatus("program");
  if (row.dataset.kind === "tasks" && item.done) applyTaskCategory(item.category);
  if (row.dataset.kind === "tasks") applyAutomaticStatus("tasks");
}
function applyTaskCategory(category) {
  const current = order();
  if (category === "Angebot") applyAutomaticStatus("offer");
  if (category === "Programm") current.milestones.program = true;
  if (category === "Zahlungslink gesendet") applyAutomaticStatus("paymentLink");
  if (category === "Zahlung eingegangen") {
    current.offer.paymentStatus = "Zahlung erhalten";
    applyAutomaticStatus("paid");
  }
  if (category === "Kunde informiert") current.milestones.offerSent = true;
  if (category === "Rechnung") current.milestones.completed = current.status === "Auftrag abgeschlossen";
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
  renderMilestones();
  document.getElementById("backupInfo").textContent = `${state.orders.length} Auftrag/Aufträge lokal gespeichert.\nLetzte Speicherung: ${new Date().toLocaleString("de-AT")}`;
}
function renderSoft() {
  renderStatusControl();
  renderDashboard();
  renderOrders();
  renderOfferPreview();
  renderWhatsApp();
  renderProgramPreview();
  renderMilestones();
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
function renderMilestones() {
  const current = order();
  const panel = document.getElementById("milestonePanel");
  if (!panel) return;
  panel.innerHTML = `<h3>Was ist erledigt?</h3><div class="milestone-grid">${MILESTONES.map(([key, label]) => `
    <label class="check-pill ${current.milestones[key] ? "done" : ""}">
      <input type="checkbox" data-field="milestones.${key}" ${current.milestones[key] ? "checked" : ""}>
      <span>${label}</span>
    </label>`).join("")}</div>`;
}
function setSyncStatus(status) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  if (!status) {
    el.textContent = "";
    return;
  }
  if (status.mode === "cloud") {
    el.textContent = `Cloud aktiv · gemeinsamer Arbeitsbereich · UID ${status.uid}`;
    el.className = "sync-status ok";
  } else {
    el.textContent = status.message || "localStorage-Fallback aktiv";
    el.className = "sync-status warn";
  }
}
function renderCloudUser(user = getCurrentFirebaseUser()) {
  const chip = document.getElementById("cloudUserChip");
  const loginButton = document.getElementById("googleLoginButton");
  const anonymousButton = document.getElementById("anonymousLoginButton");
  const logoutButton = document.getElementById("cloudLogoutButton");
  if (!chip || !loginButton || !anonymousButton || !logoutButton) return;

  if (!user) {
    chip.textContent = "Nicht angemeldet";
    loginButton.hidden = false;
    anonymousButton.hidden = false;
    logoutButton.hidden = true;
    return;
  }

  chip.textContent = user.isAnonymous ? "Testmodus aktiv" : (user.email || user.displayName || "Google angemeldet");
  loginButton.hidden = !user.isAnonymous;
  anonymousButton.hidden = true;
  logoutButton.hidden = false;
}
async function connectCloudStore() {
  if (cloudReady || cloudConnecting) return;
  cloudConnecting = true;
  setSyncStatus({ mode: "local", message: "Cloud-Daten werden geladen ..." });

  const cloud = await initCloudStore({
    localState: state,
    normalizeState: normalizeAppState,
    onStatus: setSyncStatus,
    onRemoteState(remoteState) {
      applyingRemoteState = true;
      state = normalizeAppState(remoteState);
      selectedId = state.selectedId || state.orders[0].id;
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      render();
      applyingRemoteState = false;
    }
  });

  cloudReady = cloud.online;
  cloudConnecting = false;
  state = normalizeAppState(cloud.state);
  selectedId = state.selectedId || state.orders[0].id;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  render();
  setSyncStatus(cloud.online ? { mode: "cloud", uid: getCloudUserId(), message: "Firebase verbunden" } : { mode: "local", message: cloud.message || "localStorage-Fallback aktiv" });
}
function renderDashboard() {
  const visibleOrders = state.orders.filter(item => !item.hidden);
  const revenue = visibleOrders.filter(item => ["Zahlung erhalten", "Organisation läuft", "Reservierungen erledigt", "Auftrag abgeschlossen"].includes(item.status)).reduce((sum, item) => sum + total(item), 0);
  const stats = [
    ["Neue Anfragen", count("Anfrage eingegangen")],
    ["Erstellte Angebote", count("Angebot erstellt")],
    ["Bestätigte Angebote", count("Kunde hat bestätigt") + count("Zahlung offen")],
    ["Offene Zahlungen", visibleOrders.filter(item => item.offer.paymentStatus === "Zahlung offen" && STATUSES.indexOf(item.status) >= 3).length],
    ["Laufende Aufträge", count("Organisation läuft") + count("Reservierungen erledigt")],
    ["Abgeschlossen", count("Auftrag abgeschlossen")],
    ["Monatsumsatz", money(revenue)],
    ["Sichtbar", visibleOrders.length]
  ];
  document.getElementById("dashboardCards").innerHTML = stats.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("recentOrders").innerHTML = visibleOrders.slice(0, 6).map(orderCard).join("") || `<p class="muted">Keine sichtbaren Vorgänge.</p>`;
  document.getElementById("statusFlow").innerHTML = STATUSES.map(status => `<li>${status}</li>`).join("");
}
function count(status) {
  return state.orders.filter(item => !item.hidden && item.status === status).length;
}
function renderOrders() {
  const query = (document.getElementById("searchOrders").value || "").toLowerCase();
  const showHidden = document.getElementById("showHiddenOrders")?.checked;
  const filtered = state.orders.filter(item => (showHidden || !item.hidden) && JSON.stringify([item.customer.name, item.customer.hotel, item.offer.number, item.status]).toLowerCase().includes(query));
  document.getElementById("orderList").innerHTML = filtered.map(orderCard).join("") || `<p class="muted">Keine Aufträge gefunden.</p>`;
}
function orderCard(item) {
  const steps = progressSteps(item).map(([label, done]) => `<span class="step ${done ? "done" : ""}">${esc(label)}</span>`).join("");
  return `<article class="order-card">
    <div class="order-main">
      <strong>${esc(item.customer.name || "Neue Anfrage")}</strong>
      <small>${esc(item.offer.number)} · ${esc(item.customer.hotel || "ohne Unterkunft")} · ${money(total(item))}</small>
      <small>${esc(item.customer.phone || "keine WhatsApp-Nummer")} · ${esc(item.customer.stay || "kein Zeitraum")}</small>
      <div class="progress-tags">${steps}</div>
    </div>
    <div class="order-tools">
      <span class="pill ${statusClass(item.status)}">${esc(item.status)}</span>
      <button class="small ghost" data-action="select" data-tab-target="customer" data-id="${item.id}" onclick="openOrderTab('${item.id}','customer')" type="button">Kunde</button>
      <button class="small ghost" data-action="select" data-tab-target="offer" data-id="${item.id}" onclick="openOrderTab('${item.id}','offer')" type="button">Angebot</button>
      <button class="small ghost" data-action="select" data-tab-target="whatsapp" data-id="${item.id}" onclick="openOrderTab('${item.id}','whatsapp')" type="button">WhatsApp</button>
      <button class="small ghost" data-action="select" data-tab-target="program" data-id="${item.id}" onclick="openOrderTab('${item.id}','program')" type="button">Programm</button>
      <button class="small ghost" data-action="select" data-tab-target="tasks" data-id="${item.id}" onclick="openOrderTab('${item.id}','tasks')" type="button">Aufgaben</button>
      ${item.hidden ? `<button class="small ghost" data-action="restoreOrder" data-id="${item.id}" type="button">Wieder anzeigen</button>` : `<button class="small ghost" data-action="hideOrder" data-id="${item.id}" type="button">Ausblenden</button>`}
      <button class="small danger" data-action="deleteOrder" data-id="${item.id}" type="button">Löschen</button>
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
    <label class="mini-field">Datum<input data-key="date" type="date" value="${esc(item.date)}"></label>
    <label class="mini-field">Uhrzeit<input data-key="time" type="time" value="${esc(item.time)}"></label>
    <label class="mini-field">Aktivität<input data-key="title" value="${esc(item.title)}" placeholder="z. B. Private Stadtführung"></label>
    <label class="mini-field">Ort<input data-key="place" value="${esc(item.place)}" placeholder="Treffpunkt / Adresse"></label>
    <button class="ghost small" data-action="deleteProgram" data-id="${item.id}" type="button">×</button>
    <label class="mini-field full-span">Beschreibung<textarea data-key="description" placeholder="Beschreibung für den Kunden">${esc(item.description)}</textarea></label>
    <label class="mini-field">Ansprechpartner<input data-key="contact" value="${esc(item.contact)}" placeholder="Name / Telefon"></label>
    <label class="mini-field">Kostenhinweis<input data-key="cost" value="${esc(item.cost)}" placeholder="optional"></label>
    <label class="mini-field full-span">Interne Notiz<textarea data-key="note" placeholder="nur intern sichtbar">${esc(item.note)}</textarea></label>
  </div>`).join("") || `<p class="muted">Noch keine Programmpunkte erfasst.</p>`;
  renderProgramPreview();
}
function renderProgramPreview() {
  document.getElementById("programPreview").innerHTML = sortedProgram().map(item => `<section><h3>${esc(item.date)} · ${esc(item.time || "nach Vereinbarung")}</h3><p><strong>${esc(item.title || "Programmpunkt")}</strong><br>${esc(item.place)}<br>${esc(item.description)}</p><p><small>${esc(item.contact)} ${item.cost ? "· " + esc(item.cost) : ""}</small></p></section>`).join("") || `<p>Noch kein Tagesprogramm erfasst.</p>`;
}
function renderTasks() {
  document.getElementById("taskList").innerHTML = order().tasks.map(task => `<div class="task-row ${task.done ? "done" : ""}" data-kind="tasks" data-id="${task.id}">
    <label class="task-done"><input data-key="done" type="checkbox" ${task.done ? "checked" : ""}>Durchgeführt</label>
    <select data-key="category" required>${TASK_CATEGORIES.map(category => `<option ${category === task.category ? "selected" : ""}>${category}</option>`).join("")}</select>
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
  state = normalizeAppState(data);
  selectedId = state.selectedId || state.orders[0].id;
  saveState();
  event.target.value = "";
}

async function startApp() {
  state = normalizeAppState(state);
  selectedId = state.selectedId || state.orders[0].id;
  initAuth();
  initEvents();
  render();
  renderCloudUser();
  setSyncStatus({ mode: "local", message: "Bitte mit Google anmelden, um Cloud-Daten zu synchronisieren." });

  try {
    const redirectUser = await completeGoogleRedirectSignIn();
    if (redirectUser && await enforceAllowedUser(redirectUser)) unlockApp();
  } catch (error) {
    console.warn("Google Redirect Login konnte nicht abgeschlossen werden.", error);
    setSyncStatus({ mode: "local", message: "Google Login nicht abgeschlossen. Firebase-Domain pruefen." });
  }

  onFirebaseUserChanged(user => {
    renderCloudUser(user);
    if (user) {
      if (!isAllowedFirebaseUser(user)) {
        enforceAllowedUser(user);
        return;
      }
      stopCloudStore();
      cloudReady = false;
      connectCloudStore();
      return;
    }
    stopCloudStore();
    cloudReady = false;
    cloudConnecting = false;
    setSyncStatus({ mode: "local", message: "Bitte mit Google anmelden, um Cloud-Daten zu synchronisieren." });
  });
}

startApp();

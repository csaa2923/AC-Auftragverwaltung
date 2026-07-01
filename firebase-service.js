import { getCurrentFirebaseUser } from "./firebase-auth.js";
import {
  createDataAtPathIfMissing,
  loadDataAtPath,
  saveDataAtPath,
  subscribeDataAtPath
} from "./firebase-database.js";

const APP_KEY = "act-management-center";
const DOCUMENT_KEY = "state";
const LEGACY_DOCUMENT_KEY = "app";
const WORKSPACE_ID = "alpine-concierge-tirol";
const WORKSPACE_PATH = ["workspaces", WORKSPACE_ID, "apps", APP_KEY, "documents", DOCUMENT_KEY];

let unsubscribe = null;
let saveTimer = null;
let lastSavedJson = "";
let ready = false;
let onlineAvailable = false;

function orderCount(state) {
  return Array.isArray(state?.orders) ? state.orders.length : 0;
}

function firebaseStoreErrorMessage(error) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Firestore blockiert: Rules fuer gemeinsamen Arbeitsbereich veroeffentlichen.";
  }
  if (code === "unauthenticated") {
    return "Firestore wartet auf Google Login.";
  }
  if (code === "unavailable") {
    return "Firestore derzeit nicht erreichbar. Lokaler Speicher aktiv.";
  }
  return `Firebase nicht verbunden${code ? ` (${code})` : ""}. Lokaler Speicher aktiv.`;
}

export async function initCloudStore({ localState, normalizeState, onRemoteState, onStatus }) {
  try {
    const initial = await createDataAtPathIfMissing({
      pathParts: WORKSPACE_PATH,
      data: localState
    });

    let initialState = normalizeState(initial.data || localState);
    const legacySources = [
      loadDataAtPath({
        pathParts: ["users", initial.user.uid, "apps", APP_KEY, DOCUMENT_KEY],
        dataField: "data",
        fallbackData: null,
        normalize: normalizeState
      }),
      loadDataAtPath({
        pathParts: ["users", initial.user.uid, LEGACY_DOCUMENT_KEY, DOCUMENT_KEY],
        dataField: "state",
        fallbackData: null,
        normalize: normalizeState
      })
    ];
    const legacyStates = await Promise.all(legacySources);
    const bestLegacy = legacyStates
      .filter(item => item.exists && item.data)
      .sort((a, b) => orderCount(b.data) - orderCount(a.data))[0];

    if (bestLegacy && (!initial.exists || orderCount(bestLegacy.data) > orderCount(initialState))) {
      initialState = bestLegacy.data;
      await saveDataAtPath({
        pathParts: WORKSPACE_PATH,
        data: initialState
      });
      onStatus?.({ mode: "cloud", uid: initial.user.uid, message: "Daten in gemeinsamen Arbeitsbereich uebernommen" });
    }
    onlineAvailable = true;
    ready = true;
    lastSavedJson = JSON.stringify(initialState);
    onStatus?.({ mode: "cloud", uid: initial.user.uid, message: "Firebase verbunden" });

    const subscription = await subscribeDataAtPath({
      pathParts: WORKSPACE_PATH,
      fallbackData: localState,
      normalize: normalizeState,
      onChange({ data }) {
        const remoteJson = JSON.stringify(data);
        if (remoteJson === lastSavedJson) return;
        lastSavedJson = remoteJson;
        onRemoteState(data);
      },
      onError(error) {
        console.warn("Firestore Echtzeit-Sync fehlgeschlagen.", error);
        onStatus?.({ mode: "local", uid: null, message: firebaseStoreErrorMessage(error) });
      }
    });

    unsubscribe = subscription.unsubscribe;
    return { state: initialState, uid: initial.user.uid, online: true };
  } catch (error) {
    console.warn("Firebase nicht verfuegbar, localStorage-Fallback aktiv.", error);
    ready = false;
    onlineAvailable = false;
    const message = firebaseStoreErrorMessage(error);
    onStatus?.({ mode: "local", uid: null, message });
    return { state: localState, uid: null, online: false, error, message };
  }
}

export function saveCloudState(state) {
  if (!ready || !onlineAvailable) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const json = JSON.stringify(state);
    if (json === lastSavedJson) return;
    lastSavedJson = json;
    try {
      await saveDataAtPath({
        pathParts: WORKSPACE_PATH,
        data: state
      });
    } catch (error) {
      console.warn("Speichern in Firestore fehlgeschlagen.", error);
      ready = false;
      onlineAvailable = false;
    }
  }, 350);
}

export function getCloudUserId() {
  return getCurrentFirebaseUser()?.uid || null;
}

export function stopCloudStore() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  ready = false;
  onlineAvailable = false;
}

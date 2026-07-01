import { getCurrentFirebaseUser } from "./firebase-auth.js";
import {
  createUserDataIfMissing,
  loadDataAtPath,
  saveUserData,
  subscribeUserData
} from "./firebase-database.js";

const APP_KEY = "act-management-center";
const DOCUMENT_KEY = "state";
const LEGACY_DOCUMENT_KEY = "app";

let unsubscribe = null;
let saveTimer = null;
let lastSavedJson = "";
let ready = false;
let onlineAvailable = false;

function orderCount(state) {
  return Array.isArray(state?.orders) ? state.orders.length : 0;
}

export async function initCloudStore({ localState, normalizeState, onRemoteState, onStatus }) {
  try {
    const initial = await createUserDataIfMissing({
      appKey: APP_KEY,
      documentKey: DOCUMENT_KEY,
      data: localState
    });

    let initialState = normalizeState(initial.data || localState);
    const legacy = await loadDataAtPath({
      pathParts: ["users", initial.user.uid, LEGACY_DOCUMENT_KEY, DOCUMENT_KEY],
      dataField: "state",
      fallbackData: null,
      normalize: normalizeState
    });

    if (legacy.exists && legacy.data && (!initial.exists || orderCount(legacy.data) > orderCount(initialState))) {
      initialState = legacy.data;
      await saveUserData({
        appKey: APP_KEY,
        documentKey: DOCUMENT_KEY,
        data: initialState
      });
      onStatus?.({ mode: "cloud", uid: initial.user.uid, message: "Alte Cloud-Daten wurden uebernommen" });
    }
    onlineAvailable = true;
    ready = true;
    lastSavedJson = JSON.stringify(initialState);
    onStatus?.({ mode: "cloud", uid: initial.user.uid, message: "Firebase verbunden" });

    const subscription = await subscribeUserData({
      appKey: APP_KEY,
      documentKey: DOCUMENT_KEY,
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
        onStatus?.({ mode: "local", uid: null, message: "Firestore-Sync unterbrochen" });
      }
    });

    unsubscribe = subscription.unsubscribe;
    return { state: initialState, uid: initial.user.uid, online: true };
  } catch (error) {
    console.warn("Firebase nicht verfuegbar, localStorage-Fallback aktiv.", error);
    ready = false;
    onlineAvailable = false;
    onStatus?.({ mode: "local", uid: null, message: "Offline/localStorage-Fallback" });
    return { state: localState, uid: null, online: false, error };
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
      await saveUserData({
        appKey: APP_KEY,
        documentKey: DOCUMENT_KEY,
        data: state
      });
    } catch (error) {
      console.warn("Speichern in Firestore fehlgeschlagen.", error);
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

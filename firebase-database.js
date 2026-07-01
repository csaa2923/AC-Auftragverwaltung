import {
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseApp } from "./firebase-config.js";
import { waitForFirebaseUser } from "./firebase-auth.js";

let firestoreDb;

try {
  firestoreDb = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (error) {
  console.warn("Firestore persistence konnte nicht aktiviert werden.", error);
  firestoreDb = initializeFirestore(firebaseApp, {});
}

export const firebaseDb = firestoreDb;

export function userDocumentPath(uid, appKey, documentKey = "state") {
  return ["users", uid, "apps", appKey, documentKey];
}

export function documentRefFromPath(pathParts) {
  return doc(firebaseDb, ...pathParts);
}

export async function getCurrentUserDocument(appKey, documentKey = "state") {
  const user = await waitForFirebaseUser();
  if (!user) throw new Error("Firebase Login erforderlich.");
  return {
    user,
    ref: doc(firebaseDb, ...userDocumentPath(user.uid, appKey, documentKey))
  };
}

export async function loadUserData({
  appKey,
  documentKey = "state",
  fallbackData = null,
  normalize = value => value
}) {
  const { user, ref } = await getCurrentUserDocument(appKey, documentKey);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    return { user, ref, data: normalize(fallbackData), exists: false };
  }

  return {
    user,
    ref,
    data: normalize(snapshot.data().data ?? fallbackData),
    exists: true
  };
}

export async function saveUserData({
  appKey,
  documentKey = "state",
  data,
  merge = true
}) {
  const { user, ref } = await getCurrentUserDocument(appKey, documentKey);
  await setDoc(ref, {
    data,
    updatedAt: serverTimestamp()
  }, { merge });
  return { user, ref };
}

export async function loadDataAtPath({
  pathParts,
  fallbackData = null,
  dataField = "data",
  normalize = value => value
}) {
  const user = await waitForFirebaseUser();
  if (!user) throw new Error("Firebase Login erforderlich.");

  const ref = documentRefFromPath(pathParts);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    return { user, ref, data: normalize(fallbackData), exists: false };
  }

  return {
    user,
    ref,
    data: normalize(snapshot.data()[dataField] ?? fallbackData),
    exists: true
  };
}

export async function saveDataAtPath({
  pathParts,
  data,
  merge = true
}) {
  const user = await waitForFirebaseUser();
  if (!user) throw new Error("Firebase Login erforderlich.");

  const ref = documentRefFromPath(pathParts);
  await setDoc(ref, {
    data,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByEmail: user.email || null
  }, { merge });

  return { user, ref };
}

export async function createDataAtPathIfMissing({
  pathParts,
  data
}) {
  const loaded = await loadDataAtPath({ pathParts, fallbackData: data });
  if (loaded.exists) return loaded;

  await setDoc(loaded.ref, {
    data,
    createdAt: serverTimestamp(),
    createdBy: loaded.user.uid,
    createdByEmail: loaded.user.email || null,
    updatedAt: serverTimestamp(),
    updatedBy: loaded.user.uid,
    updatedByEmail: loaded.user.email || null
  }, { merge: true });

  return { ...loaded, data };
}

export async function createUserDataIfMissing({
  appKey,
  documentKey = "state",
  data
}) {
  const loaded = await loadUserData({ appKey, documentKey, fallbackData: data });
  if (loaded.exists) return loaded;

  await setDoc(loaded.ref, {
    data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return { ...loaded, data };
}

export async function deleteUserData(appKey, documentKey = "state") {
  const { user, ref } = await getCurrentUserDocument(appKey, documentKey);
  await deleteDoc(ref);
  return { user, ref };
}

export async function subscribeUserData({
  appKey,
  documentKey = "state",
  fallbackData = null,
  normalize = value => value,
  onChange,
  onError
}) {
  const { user, ref } = await getCurrentUserDocument(appKey, documentKey);
  const unsubscribe = onSnapshot(ref, snapshot => {
    if (!snapshot.exists()) return;
    onChange?.({
      user,
      ref,
      data: normalize(snapshot.data().data ?? fallbackData),
      snapshot
    });
  }, onError);

  return { user, ref, unsubscribe };
}

export async function subscribeDataAtPath({
  pathParts,
  fallbackData = null,
  normalize = value => value,
  onChange,
  onError
}) {
  const user = await waitForFirebaseUser();
  if (!user) throw new Error("Firebase Login erforderlich.");

  const ref = documentRefFromPath(pathParts);
  const unsubscribe = onSnapshot(ref, snapshot => {
    if (!snapshot.exists()) return;
    onChange?.({
      user,
      ref,
      data: normalize(snapshot.data().data ?? fallbackData),
      snapshot
    });
  }, onError);

  return { user, ref, unsubscribe };
}

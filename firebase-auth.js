import {
  getRedirectResult,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseApp } from "./firebase-config.js";

export const firebaseAuth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export function onFirebaseUserChanged(callback) {
  return onAuthStateChanged(firebaseAuth, callback);
}

export function getCurrentFirebaseUser() {
  return firebaseAuth.currentUser;
}

export async function signInFirebaseAnonymously() {
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  const credential = await signInAnonymously(firebaseAuth);
  return credential.user;
}

export async function signInFirebaseWithGoogle({ forceAccountSelection = false } = {}) {
  if (forceAccountSelection && firebaseAuth.currentUser) {
    await signOut(firebaseAuth);
  }
  if (!forceAccountSelection && firebaseAuth.currentUser && !firebaseAuth.currentUser.isAnonymous) return firebaseAuth.currentUser;
  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    return credential.user;
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(error.code)) {
      await signInWithRedirect(firebaseAuth, googleProvider);
      return null;
    }
    throw error;
  }
}

export async function completeGoogleRedirectSignIn() {
  const credential = await getRedirectResult(firebaseAuth);
  return credential?.user || null;
}

export function waitForFirebaseUser({ anonymous = false } = {}) {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(firebaseAuth, user => {
      stop();
      if (user) {
        resolve(user);
        return;
      }
      if (!anonymous) {
        resolve(null);
        return;
      }
      signInFirebaseAnonymously().then(resolve).catch(reject);
    }, reject);
  });
}

export function signOutFirebaseUser() {
  return signOut(firebaseAuth);
}

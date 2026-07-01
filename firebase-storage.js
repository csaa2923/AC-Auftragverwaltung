import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { firebaseApp } from "./firebase-config.js";
import { waitForFirebaseUser } from "./firebase-auth.js";

export const firebaseStorage = getStorage(firebaseApp);

export function userStoragePath(uid, appKey, fileName) {
  return `users/${uid}/apps/${appKey}/${fileName}`;
}

export async function uploadUserFile({
  appKey,
  fileName,
  file,
  metadata
}) {
  const user = await waitForFirebaseUser();
  const storageRef = ref(firebaseStorage, userStoragePath(user.uid, appKey, fileName));
  const result = await uploadBytes(storageRef, file, metadata);
  const url = await getDownloadURL(result.ref);
  return { user, ref: result.ref, url };
}

export async function getUserFileUrl(appKey, fileName) {
  const user = await waitForFirebaseUser();
  const storageRef = ref(firebaseStorage, userStoragePath(user.uid, appKey, fileName));
  const url = await getDownloadURL(storageRef);
  return { user, ref: storageRef, url };
}

export async function deleteUserFile(appKey, fileName) {
  const user = await waitForFirebaseUser();
  const storageRef = ref(firebaseStorage, userStoragePath(user.uid, appKey, fileName));
  await deleteObject(storageRef);
  return { user, ref: storageRef };
}

# Concierge Management Center

Eigenstaendige interne Seite fuer Alpine Concierge Tirol.

## Start

- Startdatei lokal: `index.html`
- Empfohlen lokal: `http://localhost:48731/index.html`, nicht `file://` und moeglichst nicht `127.0.0.1`
- Produktive Firebase-Anmeldung: Google Login
- Anonymous Login: nur Testmodus/Fallback
- Firestore-Datenpfad dieser App: `users/{uid}/apps/act-management-center/state`

## Wiederverwendbare Firebase-Bibliothek

Die Firebase-Integration ist modular aufgebaut, damit zukuenftige HTML-Apps dieselbe Infrastruktur nutzen koennen:

- `firebase-config.js`: zentrale Firebase-Konfiguration und App-Initialisierung.
- `firebase-auth.js`: Google Login, Anonymous-Testmodus, aktueller Benutzer, Auth-Status und Logout.
- `firebase-access.js`: Google-E-Mail-Whitelist fuer den App-Zugang.
- `firebase-database.js`: Firestore mit Offline-Unterstuetzung, Laden, Speichern, Loeschen und Echtzeit-Sync pro Benutzer/App.
- `firebase-storage.js`: vorbereitete Dateiablage pro Benutzer/App.
- `firebase-service.js`: schmaler Adapter fuer diese konkrete Auftragsverwaltung.

Fuer eine neue HTML-App kann die Bibliothek so verwendet werden:

```js
import { signInFirebaseWithGoogle, waitForFirebaseUser } from "./firebase-auth.js";
import { loadUserData, saveUserData, subscribeUserData } from "./firebase-database.js";

const APP_KEY = "meine-neue-app";

await signInFirebaseWithGoogle();
const user = await waitForFirebaseUser();

const loaded = await loadUserData({
  appKey: APP_KEY,
  fallbackData: {}
});

await saveUserData({
  appKey: APP_KEY,
  data: loaded.data
});

await subscribeUserData({
  appKey: APP_KEY,
  fallbackData: {},
  onChange({ data }) {
    console.log("Neue Cloud-Daten", data);
  }
});
```

Dateien koennen spaeter so vorbereitet gespeichert werden:

```js
import { uploadUserFile } from "./firebase-storage.js";

await uploadUserFile({
  appKey: "meine-neue-app",
  fileName: "angebot.pdf",
  file
});
```

## Speicherung dieser App

Die Auftragsverwaltung speichert zweigleisig:

1. Firestore als zentrale Cloud-Datenbank.
2. `localStorage` als Fallback und Migrationsquelle, falls Firebase kurzfristig nicht erreichbar ist.

Nach dem Google Login werden automatisch alle Daten aus Firestore geladen. Beim ersten erfolgreichen Firebase-Start wird ein vorhandener lokaler Stand in Firestore geschrieben, falls dort noch kein Cloud-Stand existiert. Wenn bereits Cloud-Daten existieren, gewinnt der Cloud-Stand.

## Firebase Authentication

In der Firebase Console aktivieren:

- Authentication > Sign-in method > Google
- Authentication > Sign-in method > Anonymous nur fuer Testmodus/Fallback
- Authentication > Settings > Authorized domains: lokale/deployte Domains eintragen, z. B. `localhost`, Vercel-Domain und eigene Domain

Damit iPhone, Windows-PC und Mac dieselben Daten sehen, auf allen Geraeten mit demselben Google-Konto anmelden. Die verwendete UID ist dann die UID dieses Google-Benutzers.

## Google-Whitelist

Vor produktiver Nutzung die erlaubte Google-Mail eintragen:

1. In `firebase-access.js`:

```js
export const ALLOWED_GOOGLE_EMAILS = [
  "dein.name@gmail.com"
];
```

2. In `firestore.rules` und `storage.rules` denselben Wert eintragen:

```txt
request.auth.token.email in [
  "dein.name@gmail.com"
]
```

Wichtig: Die E-Mail muss exakt zur Google-Anmeldung passen. Mehrere erlaubte Personen koennen als weitere Eintraege ergaenzt werden.

## Firebase Security Rules

Die Regeln in `firestore.rules` erlauben Lesen und Schreiben nur fuer den angemeldeten und freigegebenen Benutzer:

```txt
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null
    && request.auth.uid == userId
    && request.auth.token.email in ["dein.name@gmail.com"];
}
```

Die Regeln in `storage.rules` schuetzen Dateien nach demselben Prinzip.

```txt
match /users/{userId}/{allPaths=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Diese Rules in der Firebase Console veroeffentlichen:

- Firestore Database > Rules: Inhalt aus `firestore.rules`
- Storage > Rules: Inhalt aus `storage.rules`

## Test

1. App ueber Vercel oder lokalen Server oeffnen.
2. Auf `Mit Google einloggen` klicken und mit Google anmelden.
3. Falls die App bereits offen ist: oben kann mit `Logout` wieder zur Login-Maske gewechselt werden.
4. Pruefen, ob oben `Cloud aktiv - UID ...` und die Google-Mail angezeigt werden.
5. Auf Geraet A einen Kunden/Auftrag anlegen oder aendern.
6. Auf Geraet B dieselbe App oeffnen und mit demselben Google-Konto anmelden.
7. Pruefen, ob die Aenderung automatisch erscheint.
8. Kurz offline gehen, eine Aenderung vornehmen, wieder online gehen und Sync pruefen.

## Wichtige Hinweise

- Google Login ist der produktive Standard.
- Anonymous Login bleibt nur als Testmodus und erzeugt je Browser/Geraet normalerweise eine eigene UID.
- JSON-Export/Import bleibt als Backup-Funktion erhalten.

Die oeffentliche Alpine-Concierge-Tirol-Webseite liegt nicht in diesem Projekt und wurde nicht veraendert.

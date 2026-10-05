// ─────────────────────────────────────────────
//  CotizaTrack – Capa de nube (Firebase Auth + Firestore)
//
//  Modelo de datos:
//    users/{uid}                      → perfil { email, nombre, schemaVersion, ultimoIngreso }
//    users/{uid}/cotizaciones/{id}    → un documento por cotización, con las mismas
//                                       columnas del CSV (Pagos = arreglo de mapas)
//
//  Firestore no tiene esquema: un campo nuevo en la app se guarda sin migraciones.
//  Los campos que empiezan por "_" son metadatos y no salen en el CSV.
//
//  app.js solo usa window.cloud; no importa nada de Firebase directamente.
// ─────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const SCHEMA_VERSION = 1;
const RECORDS = 'cotizaciones';
const BATCH_LIMIT = 450; // Firestore admite 500 operaciones por lote

const configured = !String(firebaseConfig.apiKey).includes('REEMPLAZAR');

let auth = null;
let db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Caché persistente: la app abre y funciona sin conexión, y sincroniza al volver.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true
  });
}

let user = null;

function recordsRef() {
  return collection(db, 'users', user.uid, RECORDS);
}

// Quita metadatos de Firestore antes de entregar el registro a la app
function fromDoc(snap) {
  const { _meta, ...fields } = snap.data();
  return { ...fields, _id: snap.id };
}

function toDoc(record) {
  const fields = {};
  Object.keys(record).forEach(k => { if (!k.startsWith('_')) fields[k] = record[k]; });
  fields._meta = { updatedAt: serverTimestamp() };
  return fields;
}

window.cloud = {
  configured,

  onUser(cb) {
    onAuthStateChanged(auth, u => {
      user = u;
      if (u) {
        setDoc(doc(db, 'users', u.uid), {
          email: u.email, nombre: u.displayName,
          schemaVersion: SCHEMA_VERSION, ultimoIngreso: serverTimestamp()
        }, { merge: true }).catch(e => console.warn('Perfil no actualizado:', e));
      }
      cb(u);
    });
  },

  async signIn() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
      throw e;
    }
  },

  signOut() { return signOut(auth); },

  newId() { return doc(recordsRef()).id; },

  // cb(registros, { fromCache, pending }) en cada cambio, local o de otro dispositivo
  subscribe(cb, onError) {
    return onSnapshot(recordsRef(), { includeMetadataChanges: false }, snap => {
      cb(snap.docs.map(fromDoc), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
    }, onError);
  },

  // Escribe registros completos (reemplaza el documento) y borra los indicados
  async commit(upserts, deleteIds) {
    const ops = [
      ...upserts.map(r => b => b.set(doc(recordsRef(), r._id), toDoc(r))),
      ...deleteIds.map(id => b => b.delete(doc(recordsRef(), id)))
    ];
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      ops.slice(i, i + BATCH_LIMIT).forEach(op => op(batch));
      await batch.commit();
    }
  }
};

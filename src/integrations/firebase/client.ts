"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase for accounts and sync. Optional: without the four
 * NEXT_PUBLIC_FIREBASE_* values, MiOS runs as before, local to the browser.
 * These values are public by design; Firestore rules protect the data.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = (): boolean => Object.values(config).every(Boolean);

let app: FirebaseApp | undefined;
let db: Firestore | undefined;

const firebaseApp = (): FirebaseApp => (app ??= getApps().length ? getApp() : initializeApp(config));

export const firebaseAuth = (): Auth => getAuth(firebaseApp());

/** Each item is stored as JSON text, so undefined fields and nested arrays never trip Firestore up. */
export const firestore = (): Firestore => (db ??= initializeFirestore(firebaseApp(), { ignoreUndefinedProperties: true }));

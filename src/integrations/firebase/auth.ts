"use client";

import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "./client";

/** What the app needs to know about the signed-in person. */
export interface Account {
  uid: string;
  email: string | null;
  name: string | null;
  /** Google accounts are verified by Google; email accounts after clicking the link. */
  verified: boolean;
  provider: "google" | "password";
}

export const toAccount = (u: User): Account => {
  const google = u.providerData.some((p) => p.providerId === "google.com");
  return {
    uid: u.uid,
    email: u.email,
    name: u.displayName,
    verified: google || u.emailVerified,
    provider: google ? "google" : "password",
  };
};

export const watchAccount = (cb: (a: Account | null) => void) => onAuthStateChanged(firebaseAuth(), (u) => cb(u ? toAccount(u) : null));

export const signInWithGoogle = async (): Promise<void> => {
  await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
};

export const signInWithEmail = async (email: string, password: string): Promise<void> => {
  await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password);
};

export const signUpWithEmail = async (email: string, password: string): Promise<void> => {
  const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
  await sendEmailVerification(cred.user);
};

export const resendVerification = async (): Promise<void> => {
  const u = firebaseAuth().currentUser;
  if (u) await sendEmailVerification(u);
};

/** After clicking the email link in another tab: refresh, and get a fresh token that says "verified". */
export const refreshAccount = async (): Promise<Account | null> => {
  const u = firebaseAuth().currentUser;
  if (!u) return null;
  await reload(u);
  await u.getIdToken(true);
  return toAccount(u);
};

export const resetPassword = async (email: string): Promise<void> => {
  await sendPasswordResetEmail(firebaseAuth(), email.trim());
};

/**
 * Deleting an account needs a fresh sign-in: Google asks again, or the
 * password is typed again.
 */
export const confirmItsYou = async (password?: string): Promise<void> => {
  const u = firebaseAuth().currentUser;
  if (!u) throw new Error("Not signed in");
  const google = u.providerData.some((p) => p.providerId === "google.com");
  if (google) await reauthenticateWithPopup(u, new GoogleAuthProvider());
  else await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email ?? "", password ?? ""));
};

/** Remove the sign-in itself. Call after confirmItsYou and after the data is deleted. */
export const deleteSignIn = async (): Promise<void> => {
  const u = firebaseAuth().currentUser;
  if (u) await deleteUser(u);
};

export const signOutAccount = async (): Promise<void> => {
  await signOut(firebaseAuth());
};

/** The current sign-in token, for MiOS's own server (the AI route). */
export const idToken = async (): Promise<string | null> => (await firebaseAuth().currentUser?.getIdToken()) ?? null;

const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use at least 6 characters for the password.",
  "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/user-disabled": "This account has been turned off.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes, then try again.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
  "auth/popup-blocked": "The browser blocked the Google window. Allow pop-ups for MiOS and try again.",
  "auth/popup-closed-by-user": "The Google window was closed before signing in.",
  "auth/cancelled-popup-request": "The Google window was closed before signing in.",
  "auth/operation-not-allowed": "This way of signing in isn't turned on for MiOS yet.",
  "auth/unauthorized-domain": "Signing in isn't allowed from this address yet.",
  "auth/requires-recent-login": "For safety, sign in again first, then try once more.",
  "auth/user-mismatch": "That's a different Google account. Choose the one you're signed in with.",
};

export const authMessage = (e: unknown): string =>
  e instanceof FirebaseError ? (MESSAGES[e.code] ?? "Something went wrong signing in. Try again.") : "Something went wrong signing in. Try again.";

"use client";

import { useSyncExternalStore } from "react";

/**
 * Phones (narrower than a tablet) get the phone layout. While it's being
 * built it's only on for whoever turns it on with ?phone=on (and off again
 * with ?phone=off); the choice is remembered in this browser.
 */
export const PHONE_QUERY = "(max-width: 767px)";
const FLAG_KEY = "mios:phone-layout";

const readFlag = (): boolean => {
  try {
    const asked = new URLSearchParams(window.location.search).get("phone");
    if (asked === "on") localStorage.setItem(FLAG_KEY, "on");
    if (asked === "off") localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === "on";
  } catch {
    return false;
  }
};

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

const snapshot = () => window.matchMedia(PHONE_QUERY).matches && readFlag();

/** True on a phone-sized screen with the phone layout turned on. False on the server. */
export const usePhone = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false);

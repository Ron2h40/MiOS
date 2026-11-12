import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Checks a Firebase sign-in token on the server, without any secret: the
 * token is signed by Google, and Google publishes the keys to check it.
 * Needs only the project id.
 */

const KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export interface Caller {
  uid: string;
  verified: boolean;
}

/** The signed-in person behind a token, or null if the token isn't valid for this project. */
export const verifyIdToken = async (token: string): Promise<Caller | null> => {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId || !token) return null;
  try {
    const { payload } = await jwtVerify(token, KEYS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
    return { uid: payload.sub, verified: payload.email_verified === true || provider === "google.com" };
  } catch {
    return null;
  }
};

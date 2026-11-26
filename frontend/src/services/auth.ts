// Firebase init + OTP anupura function
import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import type { ConfirmationResult } from "firebase/auth";

// --- HAULGO REAL FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyBpVeq9Jfuh5K1IYEE1AruY28u11loxnOE",
  authDomain: "haulgo-367df.firebaseapp.com",
  projectId: "haulgo-367df",
  storageBucket: "haulgo-367df.firebasestorage.app",
  messagingSenderId: "777824393022",
  appId: "1:777824393022:web:87921e27e2931e4de3fe6f",
  measurementId: "G-7XEEZ4Q711"
};
// ---------------------------------------------------------

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// reCAPTCHA - INVISIBLE - User ku theriyaathu, background la verify aayidum
let verifier: RecaptchaVerifier | null = null;

export const setupRecaptcha = () => {
  if (verifier) return verifier;

  verifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible",
    callback: () => {},
    "expired-callback": () => {
      // Expire aana verifier ah clear pannitu puthusa create pannu
      verifier?.clear();
      verifier = null;
    },
  });
  return verifier;
};

export const sendOtpToPhone = async (
  phoneNumber: string
): Promise<ConfirmationResult> => {
  const appVerifier = setupRecaptcha();
  // Invisible verifier ah render pannu
  await appVerifier.render();
  const confirmation = await signInWithPhoneNumber(
    auth,
    phoneNumber,
    appVerifier
  );
  return confirmation;
};

// OTP verify aana aprom / Resend pannum pothu verifier ah clear panna itha use pannu
export const clearRecaptcha = () => {
  try {
    verifier?.clear();
  } catch {}
  verifier = null;
  (window as any).recaptchaVerifier = null;
};
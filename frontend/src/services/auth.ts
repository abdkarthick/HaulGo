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

// reCAPTCHA - Firebase ku robot illa nu prove panna
export const setupRecaptcha = () => {
  if (!(window as any).recaptchaVerifier) {
    (window as any).recaptchaVerifier = new RecaptchaVerifier(
      auth,
      "recaptcha-container",
      {
        size: "invisible",
        callback: () => {},
      }
    );
  }
  return (window as any).recaptchaVerifier;
};

export const sendOtpToPhone = async (
  phoneNumber: string
): Promise<ConfirmationResult> => {
  const appVerifier = setupRecaptcha();
  const confirmation = await signInWithPhoneNumber(
    auth,
    phoneNumber,
    appVerifier
  );
  return confirmation;
};
// MSG91 Widget helper
declare global {
  interface Window {
    sendOTP?: (phoneNumber: string, onSuccess?: (data: unknown) => void, onFailure?: (error: unknown) => void) => any;
    sendOtp?: (phoneNumber: string, onSuccess?: (data: unknown) => void, onFailure?: (error: unknown) => void) => any;
    verifyOTP?: (otp: string, onSuccess?: (data: unknown) => void, onFailure?: (error: unknown) => void) => any;
    verifyOtp?: (otp: string, onSuccess?: (data: unknown) => void, onFailure?: (error: unknown) => void) => any;
    retryOTP?: () => any;
  }
}

function getOtpError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as any).message === "string") return new Error((error as any).message);
    if ("data" in error && typeof (error as any).data === "object" && (error as any).data !== null && "message" in (error as any).data) {
      return new Error((error as any).data.message);
    }
  }
  return new Error("MSG91 OTP request failed. Check the widget settings.");
}

function getSendFn() {
  return window.sendOTP || window.sendOtp;
}
function getVerifyFn() {
  return window.verifyOTP || window.verifyOtp;
}

// FIX: sendOTP oda promise = OTP SENT, callback = OTP VERIFIED. Rendu vera vera.
// Ithu OTP sent aana odane resolve aagum, verify ku wait pannaathu.
export const sendOtpToPhone = (phoneNumber: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const fn = getSendFn();
    if (typeof fn !== "function") {
      reject(new Error("OTP widget load aagala. Refresh pannu da"));
      return;
    }
    const clean = phoneNumber.replace(/^\+/, "");
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error("OTP widget timeout. Refresh panni Captcha tick pannitu try pannu.")); }
    }, 20000);

    try {
      const result: any = fn(
        clean,
        () => { /* verify success - index.html la msg91-verified event handle pannum */ },
        (err: any) => { if (!done) { done = true; clearTimeout(timer); reject(getOtpError(err)); } }
      );
      // Promise return aana, athu OTP SENT nu artham
      if (result && typeof result.then === "function") {
        result.then(
          () => { if (!done) { done = true; clearTimeout(timer); resolve(); } },
          (err: any) => { if (!done) { done = true; clearTimeout(timer); reject(getOtpError(err)); } }
        );
      } else {
        // Promise illa na, 800ms la send aayiduchu nu vaichukalam
        setTimeout(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } }, 800);
      }
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); reject(getOtpError(e)); }
    }
  });
};

// FIX: Puthu function - OTP box la type panna OTP ah verify panra
export const verifyOtpCode = (otp: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const fn = getVerifyFn();
    if (typeof fn !== "function") {
      reject(new Error("verifyOTP illa. Page ah refresh pannu da"));
      return;
    }
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("OTP verify timeout. Thumba try pannu.")); } }, 20000);

    // MSG91 success aana, index.html la iruka success callback msg91-verified event ah dispatch pannum
    const onVerified = () => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); resolve(); } };
    window.addEventListener("msg91-verified", onVerified);

    try {
      const result: any = fn(
        otp,
        () => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); resolve(); } },
        (err: any) => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); reject(getOtpError(err)); } }
      );
      if (result && typeof result.then === "function") {
        result.then(
          () => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); resolve(); } },
          (err: any) => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); reject(getOtpError(err)); } }
        );
      }
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); window.removeEventListener("msg91-verified", onVerified); reject(getOtpError(e)); }
    }
  });
};
// MSG91 Widget helper - Firebase thevai illa
declare global {
  interface Window {
    sendOtp?: (
      phoneNumber: string,
      onSuccess: (data: unknown) => void,
      onFailure: (error: unknown) => void
    ) => Promise<unknown>;
  }
}

function getOtpError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return new Error(error.message);
    }
    if ("data" in error && typeof error.data === "object" && error.data !== null &&
        "message" in error.data && typeof error.data.message === "string") {
      return new Error(error.data.message);
    }
  }
  return new Error("MSG91 OTP request failed. Check the widget settings.");
}

export const sendOtpToPhone = (phoneNumber: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof window.sendOtp === "function") {
      let completed = false;
      const finish = (error?: unknown) => {
        if (completed) return;
        completed = true;
        if (error === undefined) resolve();
        else reject(getOtpError(error));
      };

      const request = window.sendOtp(
        phoneNumber.replace(/^\+/, ""),
        () => finish(),
        (error) => finish(error)
      );
      request.then(() => {
        if (!completed) {
          finish(new Error("Complete the CAPTCHA verification, then try sending the OTP again."));
        }
      }, (error) => finish(error));
    } else {
      reject(new Error("OTP widget load aagala. Refresh pannu da"));
    }
  });
};
// MSG91 Widget helper - Firebase thevai illa
declare global {
  interface Window {
    sendOtp?: (
      phoneNumber: string,
      onSuccess: (data: unknown) => void,
      onFailure: (error: unknown) => void
    ) => unknown;
  }
}

export const sendOtpToPhone = (phoneNumber: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof window.sendOtp === "function") {
      window.sendOtp(
        phoneNumber.replace("+", ""),
        () => resolve(),
        reject
      );
    } else {
      reject(new Error("OTP widget load aagala. Refresh pannu da"));
    }
  });
};
// MSG91 Widget helper - Firebase thevai illa
declare global {
  interface Window {
    sendOTP?: any;
  }
}

export const sendOtpToPhone = (phoneNumber: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof window.sendOTP === "function") {
      window.sendOTP(
        phoneNumber.replace("+", ""),
        (data: any) => resolve(data),
        (err: any) => reject(err)
      );
    } else {
      reject(new Error("OTP widget load aagala. Refresh pannu da"));
    }
  });
};
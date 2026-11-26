import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";
import { sendOtpToPhone } from "../services/auth";

type AuthContextType = {
  phone: string;
  setPhone: (p: string) => void;
  confirmation: null;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  user: null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async (phoneNumber: string) => {
    setLoading(true);
    try {
      await sendOtpToPhone(phoneNumber);
      setPhone(phoneNumber);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (_otp: string) => {
    // MSG91 Widget popup la than verify nadakum
    localStorage.setItem("haulgo_verified", "true");
  };

  return (
    <AuthContext.Provider
      value={{ phone, setPhone, confirmation: null, sendOtp, verifyOtp, user: null, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
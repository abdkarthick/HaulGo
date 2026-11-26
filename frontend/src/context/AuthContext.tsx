import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";
import { ConfirmationResult, User } from "firebase/auth";
import { sendOtpToPhone } from "../services/auth";

type AuthContextType = {
  phone: string;
  setPhone: (p: string) => void;
  confirmation: ConfirmationResult | null;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<User>;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [phone, setPhone] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const sendOtp = async (phoneNumber: string) => {
    setLoading(true);
    try {
      const result = await sendOtpToPhone(phoneNumber);
      setConfirmation(result);
      setPhone(phoneNumber);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (otp: string) => {
    if (!confirmation) throw new Error("OTP anupala. Thumba try pannu.");
    setLoading(true);
    try {
      const res = await confirmation.confirm(otp);
      setUser(res.user);
      return res.user;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{ phone, setPhone, confirmation, sendOtp, verifyOtp, user, loading }}
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
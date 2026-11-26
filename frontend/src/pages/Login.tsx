import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const { sendOtp, loading } = useAuth();
  const navigate = useNavigate();

  const handleSendOtp = async () => {
    setError("");
    if (number.length !== 10) {
      setError("10 digit mobile number podu da.");
      return;
    }
    try {
      const fullNumber = "+91" + number;
      await sendOtp(fullNumber);
      navigate("/otp");
    } catch (e: any) {
      console.error(e);
      setError("OTP anupa mudiyala. Firebase config / Phone Auth enable panniya nu paaru.");
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "60px auto", padding: 20, textAlign: "center" }}>
      <h2>HaulGo Login</h2>
      <p>Un mobile number podu, OTP varum.</p>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <span style={{ padding: "12px", border: "1px solid #ccc", borderRadius: 8 }}>+91</span>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="9876543210"
          inputMode="numeric"
          style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #ccc", fontSize: 16 }}
        />
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button
        onClick={handleSendOtp}
        disabled={loading}
        style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 10, background: "#000", color: "#fff", fontSize: 16, cursor: "pointer" }}
      >
        {loading ? "Anupurathu..." : "Get OTP"}
      </button>

      {/* Firebase ku thevai - itha azhika koodathu */}
      <div id="recaptcha-container"></div>
    </div>
  );
}
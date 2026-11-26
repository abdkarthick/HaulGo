import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Otp() {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const { verifyOtp, loading, phone } = useAuth();
  const navigate = useNavigate();

  const handleVerify = async () => {
    setError("");
    if (otp.length !== 6) {
      setError("6 digit OTP podu.");
      return;
    }
    try {
      await verifyOtp(otp);
      navigate("/"); // Login aana aprom enga poga numo anga maathiko
    } catch (e: any) {
      console.error(e);
      setError("OTP thappu da. Thumba try pannu.");
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "60px auto", padding: 20, textAlign: "center" }}>
      <h2>OTP Verify Pannu</h2>
      <p>{phone} ku OTP anupiyachu.</p>

      <input
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        inputMode="numeric"
        style={{ width: "100%", padding: 14, fontSize: 22, textAlign: "center", letterSpacing: 8, borderRadius: 10, border: "1px solid #ccc", marginTop: 20 }}
      />

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button
        onClick={handleVerify}
        disabled={loading}
        style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 10, background: "#000", color: "#fff", fontSize: 16, cursor: "pointer" }}
      >
        {loading ? "Check panren..." : "Verify OTP"}
      </button>

      <p style={{ marginTop: 12, fontSize: 14 }} onClick={() => navigate("/login")} >
        Number maatha numna inga click pannu
      </p>
    </div>
  );
}
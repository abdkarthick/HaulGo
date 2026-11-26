import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Otp() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => navigate("/", { replace: true });
    window.addEventListener("msg91-verified", handler);
    return () => window.removeEventListener("msg91-verified", handler);
  }, [navigate]);

  return (
    <div style={{ maxWidth: 400, margin: "60px auto", padding: 20, textAlign: "center" }}>
      <h2>OTP Verify Pannu</h2>
      <p>Popup la OTP ah potu verify pannu da. Popup close aayiducha, Login page ku poi thirumba try pannu.</p>
      <button
        onClick={() => navigate("/login")}
        style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 10, background: "#000", color: "#fff", fontSize: 16, cursor: "pointer" }}
      >
        Login ku pogu
      </button>
    </div>
  );
}
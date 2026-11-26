import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // MSG91 success aana, /otp page ku pogama direct ah home ku anuppu
  useEffect(() => {
    const handleVerified = (e: any) => {
      console.log("MSG91 Verified:", e.detail);
      localStorage.setItem("haulgo_phone", "+91" + number);
      localStorage.setItem("haulgo_verified", "true");
      navigate("/");
    };
    window.addEventListener("msg91-verified", handleVerified);
    return () => window.removeEventListener("msg91-verified", handleVerified);
  }, [number, navigate]);

  const handleSendOtp = async () => {
    setError("");
    if (number.length !== 10) {
      setError("10 digit mobile number podu da.");
      return;
    }

    setLoading(true);

    // MSG91 Widget iruka nu check pannu
    // @ts-ignore
    if (typeof window.sendOTP === "function") {
      // @ts-ignore
      window.sendOTP(
        "91" + number,
        (data: any) => {
          console.log("OTP Sent", data);
          setLoading(false);
          // Widget popup open aayidum, anga OTP potta pothum
        },
        (err: any) => {
          console.log("OTP Error", err);
          setLoading(false);
          setError("OTP anupa mudiyala. MSG91 Widget load aacha nu paaru.");
        }
      );
    } else {
      setLoading(false);
      setError("OTP widget load aagala da. Page ah refresh panni thirumba try pannu.");
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

      {/* MSG91 Widget itha use pannum - Firebase recaptcha thevai illa, atha eduthuten */}
    </div>
  );
}
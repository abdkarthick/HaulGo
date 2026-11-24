import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ToastProvider } from "./lib/session";
import { LangProvider } from "./lib/i18n";
import { Loading } from "./components/ui";

// PERF FIX: IntroShell ah kooda lazy - 3D Intro code Home la udane vendaam
const IntroShell = lazy(() => import("./pages/Intro"));
const Welcome = lazy(() => import("./pages/Welcome"));
const CustomerApp = lazy(() => import("./customer/CustomerApp"));
const DriverApp = lazy(() => import("./driver/DriverApp"));
const AdminApp = lazy(() => import("./admin/AdminApp"));
const Track = lazy(() => import("./pages/Track"));

export default function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <Suspense fallback={<div className="min-h-screen bg-obsidian"><Loading /></div>}>
          <Routes>
            <Route path="/" element={<IntroShell><Welcome /></IntroShell>} />
            <Route path="/customer/*" element={<CustomerApp />} />
            <Route path="/driver/*" element={<DriverApp />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="/track/:token" element={<Track />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </LangProvider>
  );
}
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { ago, usePoll } from "../lib/util";
import { Loading, StatusBadge, Warn } from "../components/ui";
import MapView from "../components/MapView";
import { Logo } from "../components/SvgArt";

export default function Track() {
  const { token } = useParams();
  const poll = usePoll(() => api("customer", `/track/${token}`), 8000, [token]);
  const t: any = poll.data;
  const d = t?.driver;
  return (
    <div className="min-h-screen bg-offwhite">
      <header className="bg-obsidian px-4 py-3"><Logo light /></header>
      <main className="max-w-xl mx-auto p-4 space-y-4">
        {!t && !poll.error && <Loading />}
        {!t && poll.error && <div className="card p-6 text-center"><p className="font-extrabold">Tracking link not valid</p><p className="text-sm text-steel mt-1">The link may be wrong or the trip is no longer shared.</p></div>}
        {t && (
          <>
            <div className="card p-4 space-y-2"><div className="flex items-center justify-between"><p className="font-extrabold text-lg">{t.code}</p><StatusBadge s={t.status} /></div>
              <p className="text-sm text-steel">{t.pickup_address} → {t.drop_address}</p>
              {d && <p className="text-sm">{d.vehicle}{d.reg_no ? ` · ${d.reg_no}` : ""}{d.name ? ` · Driver ${d.name}` : ""}</p>}</div>
            <div className="rounded-2xl overflow-hidden"><MapView height={340} pickup={{ lat: t.pickup_lat, lng: t.pickup_lng }} drop={{ lat: t.drop_lat, lng: t.drop_lng }} driver={d?.lat != null ? { lat: d.lat, lng: d.lng } : null} driverStale={d?.location_stale} /></div>
            {!d || d.lat == null ? <Warn>Live location is not available yet. It appears once the driver is on the way.</Warn> : d.location_stale ? <Warn tone="red">Last location update was {ago(d.location_updated_at)}. The driver may have weak network.</Warn> : <p className="text-xs text-steel text-center">Last updated {ago(d.location_updated_at)} · refreshes automatically</p>}
            <p className="text-[11px] text-steel text-center">Contact numbers and OTPs are never shown on this page.</p>
          </>
        )}
      </main>
    </div>
  );
}

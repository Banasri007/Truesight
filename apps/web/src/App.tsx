import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, get, setUnauthorizedHandler } from "./api";
import { Shell } from "./console/Shell";
import { Toasts } from "./console/ui";
import { connectEvents, disconnectEvents } from "./events";
import { useRoute } from "./lib/route";
import { Dashboard } from "./pages/Dashboard";
import { EvidencePage } from "./pages/Evidence";
import { LedgerPage } from "./pages/Ledger";
import { Login } from "./pages/Login";
import { PrivacyPage } from "./pages/Privacy";
import { SimulatorPage } from "./pages/Simulator";
import { Teach } from "./pages/Teach";
import { VerifyPage } from "./pages/Verify";
import type { Status } from "./types";

const Landing = lazy(() => import("./landing/Landing"));

type Session = { authRequired: boolean; authenticated: boolean };

export function App() {
  const route = useRoute();

  if (route.page === "home") {
    return (
      <Suspense fallback={<div className="min-h-screen bg-ink-950" />}>
        <Landing />
      </Suspense>
    );
  }
  return <Console page={route.page} arg={route.arg} />;
}

function Console({ page, arg }: { page: string; arg: string | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const refreshStatus = useCallback(() => {
    get<Status>("/api/status").then(setStatus, () => undefined);
  }, []);

  // The API server can still be booting when the page first loads (dev), so retry quietly.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    setUnauthorizedHandler(() => setSession((s) => (s ? { ...s, authenticated: false } : s)));
    const load = () =>
      get<Session>("/api/session").then(
        (s) => {
          if (cancelled) return;
          setOffline(false);
          setSession(s);
        },
        (error: unknown) => {
          if (cancelled) return;
          if (error instanceof ApiError && error.status < 500) return setSession({ authRequired: false, authenticated: true });
          setOffline(true);
          setTimeout(load, Math.min(4000, 500 * 2 ** attempt++));
        },
      );
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    connectEvents();
    refreshStatus();
    const id = setInterval(refreshStatus, 15_000);
    return () => {
      clearInterval(id);
      disconnectEvents();
    };
  }, [session?.authenticated, refreshStatus]);

  // The verifier is public: anyone can check a bundle without signing in.
  if (page === "verify") {
    return (
      <Shell page={page} status={status} authed={!!session?.authenticated}>
        <VerifyPage />
      </Shell>
    );
  }
  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950">
        <div className="text-center">
          <div className="mx-auto mb-5 h-px w-40 overflow-hidden bg-line">
            <div className="h-full w-1/3 animate-[slide-x_1.4s_ease-in-out_infinite] bg-signal" />
          </div>
          <p className="eyebrow">{offline ? "Waiting for the TrueSight server…" : "Connecting"}</p>
        </div>
      </div>
    );
  }
  if (!session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />;

  let content;
  switch (page) {
    case "teach":
      content = <Teach editId={arg} />;
      break;
    case "evidence":
      content = <EvidencePage />;
      break;
    case "privacy":
      content = <PrivacyPage status={status} />;
      break;
    case "ledger":
      content = <LedgerPage />;
      break;
    case "simulator":
      content = <SimulatorPage />;
      break;
    default:
      content = <Dashboard status={status} />;
  }
  return (
    <Shell page={page} status={status} authed>
      {content}
      <Toasts />
    </Shell>
  );
}

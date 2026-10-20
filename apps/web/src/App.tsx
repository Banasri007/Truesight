import { useCallback, useEffect, useState, type ReactNode } from "react";
import { get, post, setUnauthorizedHandler } from "./api";
import { Toasts } from "./components";
import { connectEvents, disconnectEvents } from "./events";
import { Dashboard } from "./pages/Dashboard";
import { EvidencePage } from "./pages/Evidence";
import { LedgerPage } from "./pages/Ledger";
import { PrivacyPage } from "./pages/Privacy";
import { SimulatorPage } from "./pages/Simulator";
import { Teach } from "./pages/Teach";
import { VerifyPage } from "./pages/Verify";
import type { Status } from "./types";

function parseHash(): { page: string; arg: string | null } {
  const [path] = window.location.hash.replace(/^#\/?/, "").split("?");
  const [page, arg] = (path ?? "").split("/");
  return { page: page || "dashboard", arg: arg ?? null };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = `#/${path}`;
}

const NAV = [
  { page: "dashboard", label: "Sensors", icon: "◉" },
  { page: "teach", label: "Teach a sensor", icon: "＋" },
  { page: "evidence", label: "Evidence", icon: "▣" },
  { page: "privacy", label: "Privacy", icon: "◐" },
  { page: "ledger", label: "Ledger", icon: "⛓" },
  { page: "verify", label: "Verify a bundle", icon: "✓" },
  { page: "simulator", label: "Simulator", icon: "◇", simOnly: true },
];

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const refreshStatus = useCallback(() => {
    get<Status>("/api/status").then(setStatus, () => undefined);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession((s) => (s ? { ...s, authenticated: false } : s)));
    get<{ authRequired: boolean; authenticated: boolean }>("/api/session").then(setSession, () => setSession({ authRequired: false, authenticated: true }));
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

  // The verify page is public: anyone can check a bundle without signing in.
  if (route.page === "verify") {
    return (
      <Shell route={route.page} status={status} authed={!!session?.authenticated}>
        <VerifyPage />
      </Shell>
    );
  }
  if (!session) return null;
  if (!session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />;

  let content;
  switch (route.page) {
    case "teach":
      content = <Teach editId={route.arg} />;
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
    <Shell route={route.page} status={status} authed>
      {content}
      <Toasts />
    </Shell>
  );
}

function Shell({ route, status, authed, children }: { route: string; status: Status | null; authed: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            Witness
            <small>for Ring</small>
          </div>
        </div>
        {NAV.filter((item) => (authed || item.page === "verify") && (!item.simOnly || status?.ringMode === "simulator")).map((item) => (
          <a key={item.page} href={`#/${item.page}`} className={route === item.page ? "active" : ""}>
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </a>
        ))}
        <div className="spacer" />
        {status && (
          <div className="foot">
            {status.ringMode === "simulator" ? "Simulated Ring account" : status.ring.linked ? "Ring account linked" : "Ring not linked"}
            <br />v{status.version}
          </div>
        )}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="main" style={{ maxWidth: 420, margin: "12vh auto" }}>
      <div className="card card-body stack">
        <h1>Witness for Ring</h1>
        <p className="muted">This server is protected. Enter the ADMIN_TOKEN from its .env file.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            post("/api/login", { token }).then(onDone, () => setError("That token is not correct."));
          }}
        >
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" autoFocus />
          <button className="primary" type="submit">Sign in</button>
          {error && <p className="error-text">{error}</p>}
        </form>
        <a href="#/verify">Verify an evidence bundle without signing in →</a>
      </div>
    </div>
  );
}

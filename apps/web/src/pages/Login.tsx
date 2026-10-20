import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { post } from "../api";
import { Wordmark } from "../components/Logo";
import { EASE } from "../console/ui";

export function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 px-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_30%,rgb(58_155_255/0.14),transparent_70%)]" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }} className="panel relative w-full max-w-sm p-8">
        <Wordmark />
        <h1 className="display mt-8 text-4xl">Sign in to the console</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-fog">This server is protected. Enter the ADMIN_TOKEN from its .env file.</p>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            post("/api/login", { token }).then(onDone, () => setError("That token is not correct."));
          }}
        >
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" autoFocus />
          <button className="btn btn-primary w-full" type="submit">
            Sign in <ArrowRight className="size-4" />
          </button>
          {error && <p className="text-[13px] text-ember">{error}</p>}
        </form>
        <a href="#/verify" className="mt-6 block text-[13px] text-signal hover:underline">
          Verify an evidence bundle without signing in →
        </a>
      </motion.div>
    </div>
  );
}

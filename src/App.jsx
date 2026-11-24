import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "./lib/api.js";
import { Button } from "./components/ui.jsx";
import { Field } from "./components/Interactions.jsx";
const Workspace = lazy(() => import("./views/Workspace.jsx"));
export default function App() {
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    api("/api/auth/me")
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  if (!state)
    return (
      <main className="auth-page">
        <h1>Codex Companion</h1>
        <p>{error || "Opening your workspace…"}</p>
        {error && <Button onClick={refresh}>Retry</Button>}
      </main>
    );
  if (state.user)
    return (
      <Suspense
        fallback={<main className="auth-page">Opening your workspace…</main>}
      >
        <Workspace
          user={state.user}
          onLogout={async () => {
            await api("/api/auth/logout", { method: "POST" });
            location.assign(location.pathname);
          }}
        />
      </Suspense>
    );
  const creating = state.setup || register;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="workspace-eyebrow">Codex Companion</p>
        <h1>
          {state.setup
            ? "Your team’s next chapter."
            : creating
              ? "Join your team."
              : "Welcome back."}
        </h1>
        <p className="workspace-description">
          Connect the work, understand the outcome, share what helped.
        </p>
        <form
          className="space-y-5 mt-8"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const b = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await api("/api/auth/" + (creating ? "register" : "login"), {
                method: "POST",
                body: JSON.stringify(b),
              });
              await refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {creating && (
            <Field label="Your name">
              <input name="name" required maxLength={80} autoComplete="name" />
            </Field>
          )}
          <Field label="Username">
            <input
              name="username"
              required
              pattern="[a-zA-Z0-9_.\-]{3,60}"
              autoComplete="username"
            />
          </Field>
          <Field
            label="Password"
            hint={creating ? "At least 12 characters." : undefined}
          >
            <input
              name="password"
              type="password"
              required
              minLength={creating ? 12 : undefined}
              maxLength={200}
              autoComplete={creating ? "new-password" : "current-password"}
            />
          </Field>
          {creating && !state.setup && (
            <Field label="Team invitation code">
              <input name="invite" required autoComplete="off" />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Please wait…"
              : state.setup
                ? "Create installation owner"
                : creating
                  ? "Join workspace"
                  : "Sign in"}
          </Button>
        </form>
        {!state.setup && (
          <button
            className="text-sm underline mt-5"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "Have an invitation? Create an account"}
          </button>
        )}
        {state.setup && (
          <p className="text-xs text-mutedForeground mt-6 leading-5">
            The first account owns the session data on this computer. Create a
            team after signing in and invite colleagues. Their private sessions
            remain on their own computers.
          </p>
        )}
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/auth-provider";

export function AuthPanel() {
  const { signInWithOtp, signInWithGoogle, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);

    const result = await signInWithOtp(email);
    if (result.error) {
      setStatus(result.error);
      return;
    }

    setStatus("Magic link sent. Check your inbox and return to this tab.");
  }

  async function handleGoogleSignIn() {
    setStatus(null);
    const result = await signInWithGoogle();
    if (result.error) {
      setStatus(result.error);
    }
  }

  return (
    <div className="auth-container">
      <button type="button" className="google-button" onClick={handleGoogleSignIn} disabled={loading}>
        Continue with Google
      </button>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={loading}
          className="auth-input"
        />
        <button type="submit" disabled={loading || !email.trim()} className="auth-submit">
          {loading ? "Sending..." : "Send Magic Link"}
        </button>
      </form>

      {status ? <p className="auth-status">{status}</p> : null}
    </div>
  );
}

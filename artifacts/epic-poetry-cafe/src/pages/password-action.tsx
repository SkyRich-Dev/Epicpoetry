import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button, Input, Label } from "../components/ui-extras";

const AUTH_MESSAGE_KEY = "epicpoetry.authMessage";

type PasswordActionPageProps = {
  mode: "setup" | "reset" | "change";
  token: string;
};

type TokenInfo = {
  purpose: string;
  expiresAt: string;
  used: boolean;
  expired: boolean;
  email?: string | null;
  username?: string;
  fullName?: string;
  requiresPasswordInput?: boolean;
};

const headings = {
  setup: {
    title: "Create your password",
    subtitle: "Finish setting up your EpicPoetry account.",
    success: "Password created successfully. You can now sign in.",
  },
  reset: {
    title: "Reset your password",
    subtitle: "Choose a new password for your EpicPoetry account.",
    success: "Password reset successfully. You can now sign in.",
  },
  change: {
    title: "Confirm password change",
    subtitle: "Review and confirm the email-verified password change request.",
    success: "Password changed successfully. You can now sign in with your new password.",
  },
} as const;

export default function PasswordActionPage({ mode, token }: PasswordActionPageProps) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const copy = useMemo(() => headings[mode], [mode]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const base = import.meta.env.BASE_URL || "/";
        const res = await fetch(`${base}api/auth/password-tokens/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!ignore) setError(data?.error || "This password link is invalid.");
          return;
        }
        if (!ignore) setInfo(data);
      } catch {
        if (!ignore) setError("Unable to validate this password link right now.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (info?.requiresPasswordInput) {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/auth/password-tokens/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info?.requiresPasswordInput ? { token, password, confirmPassword } : { token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Unable to complete this password action.");
        return;
      }
      try {
        window.sessionStorage.setItem(AUTH_MESSAGE_KEY, copy.success);
      } catch {}
      setLocation("/login");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}images/platr-logo.png`}
            alt="Platr"
            className="h-16 mx-auto mb-6 object-contain"
          />
          <h1 className="text-2xl font-display font-bold text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{copy.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
          {loading ? (
            <div className="text-sm text-muted-foreground">Checking your link...</div>
          ) : (
            <>
              {error ? (
                <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm font-medium border border-destructive/20">
                  {error}
                </div>
              ) : null}

              {!error && info ? (
                <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm border border-emerald-200/50">
                  <div className="font-medium">{info.fullName || info.username || "Account"}</div>
                  {info.email ? <div className="mt-1 text-emerald-700/80">{info.email}</div> : null}
                  <div className="mt-2 text-emerald-700/80">
                    Link expires on {new Date(info.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
              ) : null}

              {info?.requiresPasswordInput && !error ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">New Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimum 6 characters"
                      value={password}
                      onChange={(e: any) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e: any) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </>
              ) : null}

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold rounded-xl mt-2"
                disabled={loading || submitting || !!error}
              >
                {submitting ? "Submitting..." : info?.requiresPasswordInput ? "Save Password" : "Confirm Password Change"}
              </Button>
            </>
          )}
        </form>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-6 tracking-wide">
          <Link href="/login" className="font-semibold text-muted-foreground/80">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

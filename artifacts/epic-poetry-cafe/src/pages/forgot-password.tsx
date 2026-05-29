import React, { useState } from "react";
import { Link } from "wouter";
import { Button, Input, Label } from "../components/ui-extras";

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, tenant: tenant.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Unable to start password reset.");
        return;
      }
      setSuccess(data?.message || "If the account exists, a password reset email has been sent.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}images/platr-logo.png`}
            alt="Platr"
            className="h-16 mx-auto mb-6 object-contain"
          />
          <h1 className="text-2xl font-display font-bold text-foreground">Forgot password</h1>
          <p className="text-sm text-muted-foreground mt-1.5">We&apos;ll email you a secure password reset link.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
          {error ? (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm font-medium border border-destructive/20">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200/20">
              {success}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="username">Login Email / Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e: any) => setUsername(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant">Tenant / Schema (optional)</Label>
            <Input
              id="tenant"
              value={tenant}
              onChange={(e: any) => setTenant(e.target.value)}
              placeholder="Only needed if your login uses a tenant identifier"
            />
          </div>

          <Button type="submit" className="w-full h-11 text-sm font-semibold rounded-xl mt-2" disabled={submitting}>
            {submitting ? "Sending..." : "Send reset email"}
          </Button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-6 tracking-wide">
          <Link href="/login" className="font-semibold text-muted-foreground/80">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

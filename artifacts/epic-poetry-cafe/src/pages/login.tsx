import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { useLogin } from '@workspace/api-client-react';
import { Input, Button, Label } from '../components/ui-extras';
import { Lock, User as UserIcon } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { mutateAsync: loginMutation, isPending } = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await loginMutation({ data: { username, password } });
      login(res.token, res.user);
      setLocation('/');
    } catch (err: any) {
      setError(err?.data?.message || 'Invalid credentials. Please try again.');
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
          <h1 className="text-2xl font-display font-bold text-foreground">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Welcome back to Platr.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm font-medium border border-destructive/20 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" size={16} />
              <Input
                id="username"
                className="pl-9"
                placeholder="admin"
                value={username}
                onChange={(e: any) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" size={16} />
              <Input
                id="password"
                type="password"
                className="pl-9"
                placeholder="••••••••"
                value={password}
                onChange={(e: any) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <Button type="submit" className="w-full h-11 text-sm font-semibold rounded-xl mt-2" disabled={isPending}>
            {isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-6 tracking-wide">
          Powered by <span className="font-semibold text-muted-foreground/80">SkyRich</span>
        </p>
      </div>
    </div>
  );
}

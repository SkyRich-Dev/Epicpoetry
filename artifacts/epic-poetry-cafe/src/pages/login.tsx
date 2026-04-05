import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLogin } from '@workspace/api-client-react';
import { Input, Button, Label, cn } from '../components/ui-extras';
import { Coffee, Lock, User as UserIcon } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const { mutateAsync: loginMutation, isPending } = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await loginMutation({ data: { username, password } });
      login(res.token);
    } catch (err: any) {
      setError(err?.data?.message || 'Invalid credentials. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Left side - Image */}
      <div className="md:w-1/2 lg:w-3/5 hidden md:block relative">
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-background z-10" />
        <img 
          src={`${import.meta.env.BASE_URL}images/login-bg.png`} 
          alt="Epic Poetry Cafe" 
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-16 left-16 z-20 text-white max-w-lg">
          <h2 className="text-4xl font-display font-bold mb-3 drop-shadow-lg leading-tight">Where Love Meets Flavor & Vibe.</h2>
          <p className="text-white/80 text-lg drop-shadow-md">Operational intelligence for the modern cafe.</p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-16 relative">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white shadow-lg mb-6 border border-border/50">
              <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-16 h-16 object-contain" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Welcome Back</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">Sign in to manage Epic Poetry Cafe</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3.5 bg-destructive/8 text-destructive rounded-xl text-sm font-medium border border-destructive/15 flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                {error}
              </div>
            )}
            
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" size={17} />
                <Input 
                  id="username" 
                  className="pl-10"
                  placeholder="admin / manager"
                  value={username}
                  onChange={(e: any) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" size={17} />
                <Input 
                  id="password" 
                  type="password"
                  className="pl-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e: any) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="pt-3">
              <Button type="submit" className="w-full h-11 text-sm font-semibold rounded-xl" disabled={isPending}>
                {isPending ? 'Authenticating...' : 'Sign In'}
              </Button>
            </div>
          </form>

          <p className="text-center text-xs text-muted-foreground/60 mt-8">
            Secure access restricted to authorized personnel only.
          </p>
          <p className="text-center text-[11px] text-muted-foreground/40 mt-3">
            Powered by SkyRich
          </p>
        </div>
      </div>
    </div>
  );
}

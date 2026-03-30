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
        <div className="absolute inset-0 bg-black/20 mix-blend-multiply z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-background/90 z-10" />
        <img 
          src={`${import.meta.env.BASE_URL}images/login-bg.png`} 
          alt="Epic Poetry Cafe" 
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-12 left-12 z-20 text-white max-w-md">
          <h2 className="text-4xl font-display font-bold mb-4 drop-shadow-lg">Where Coffee Meets Art.</h2>
          <p className="text-white/90 text-lg drop-shadow-md">Operational intelligence for the modern cafe.</p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16 relative">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-white shadow-xl mb-6 border border-border/50">
              <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-20 h-20 object-contain" />
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">Welcome Back</h1>
            <p className="text-muted-foreground mt-2">Sign in to manage Epic Poetry Cafe</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 bg-card p-8 rounded-3xl shadow-xl shadow-black/5 border border-border/50">
            {error && (
              <div className="p-4 bg-destructive/10 text-destructive rounded-xl text-sm font-medium border border-destructive/20 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                {error}
              </div>
            )}
            
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
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
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
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

            <div className="pt-4">
              <Button type="submit" className="w-full h-12 text-base font-semibold rounded-xl" disabled={isPending}>
                {isPending ? 'Authenticating...' : 'Sign In'}
              </Button>
            </div>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Secure access restricted to authorized personnel only.
          </p>
        </div>
      </div>
    </div>
  );
}

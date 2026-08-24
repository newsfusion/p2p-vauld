import { useState } from 'react';
import { Shield, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { sendBackground } from '../../shared/messages.js';
import { RUNTIME_NAMES } from '../../shared/runtime-names.js';
import { BrandBanner } from '../../shared/BrandBanner.js';
import { PasswordStrengthMeter } from '../../shared/components/PasswordStrengthMeter.js';

interface OnboardingModalProps {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState<'choice' | 'password' | 'confirmInvisible'>('choice');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleInvisibleKey() {
    setSaving(true);
    try {
      const response = await sendBackground({ type: 'INIT_INVISIBLE_KEY' });
      if (!response?.success) {
        setError('Failed to initialize encryption.');
        setSaving(false);
        return;
      }
      await chrome.storage.local.set({
        [RUNTIME_NAMES.onboardingComplete]: true,
      });
      onComplete();
    } catch {
      setError('Failed to initialize encryption. Please try again.');
      setSaving(false);
    }
  }

  async function handleMasterPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Password is required.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const response = await sendBackground({
        type: 'SETUP_MASTER_PASSWORD',
        payload: { password },
      });
      if (response?.error) {
        setError(response.error);
        setSaving(false);
        return;
      }
      await chrome.storage.local.set({
        [RUNTIME_NAMES.onboardingComplete]: true,
      });
      setPassword('');
      setConfirm('');
      onComplete();
    } catch {
      setError('Failed to set up master password. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Set up security">
      <div className="card w-full max-w-md mx-4 modal-pop">
        {step === 'choice' ? (
          <>
            <div className="mb-4">
              <BrandBanner className="mb-3" imageClassName="h-10 w-auto" />
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Welcome to P2P Portfolio Tracker
                </h2>
                <p className="text-sm text-muted-foreground">Choose your security method</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-6">
              Your credentials are always encrypted with AES-256-GCM. Choose how to protect your
              encryption key:
            </p>

            <div className="space-y-3">
              <button
                onClick={() => setStep('password')}
                className="w-full text-left border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="h-4 w-4 text-foreground" />
                  <p className="font-medium text-foreground">Set a Master Password</p>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Better protection if someone can access your device or browser profile. You will
                  need to unlock the extension manually.
                </p>
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setStep('confirmInvisible');
                }}
                className="w-full text-left border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="h-4 w-4 text-foreground" />
                  <p className="font-medium text-foreground">Use Invisible Key</p>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  No password needed. Encryption key stays in your browser profile for seamless
                  unlocks.
                </p>
              </button>
            </div>
          </>
        ) : step === 'confirmInvisible' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Confirm Invisible Key</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This mode stores your encryption key in the local browser profile. If someone can
              read this Chrome profile on your device, they may be able to decrypt saved platform
              credentials.
            </p>
            <p className="text-sm text-muted-foreground">
              Choose this only if password-free unlock matters more than stronger protection
              against local profile access.
            </p>

            {error && <p className="error">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('choice');
                }}
                className="flex-1 h-11 rounded-lg border border-input bg-background text-foreground text-sm font-medium transition hover:bg-accent/40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleInvisibleKey}
                disabled={saving}
                className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {saving ? 'Setting up…' : 'Continue'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleMasterPassword} className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Lock className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Set Master Password</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This password is never stored. You will need it every time you unlock the extension.
            </p>

            <label className="flex flex-col gap-2 text-sm text-foreground">
              Password
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={1024}
                  autoComplete="new-password"
                  aria-describedby={password ? "onboarding-password-strength" : undefined}
                  className="h-11 w-full rounded-md border border-border/60 bg-muted/50 px-3 pr-10 focus:border-primary/50"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <PasswordStrengthMeter
              id="onboarding-password-strength"
              password={password}
            />

            <label className="flex flex-col gap-2 text-sm text-foreground">
              Confirm Password
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  maxLength={1024}
                  autoComplete="new-password"
                  className="h-11 w-full rounded-md border border-border/60 bg-muted/50 px-3 pr-10 focus:border-primary/50"
                />
                <button
                  type="button"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            {error && <p className="error">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPassword('');
                  setConfirm('');
                  setStep('choice');
                }}
                className="flex-1 h-11 rounded-lg border border-input bg-background text-foreground text-sm font-medium transition hover:bg-accent/40"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {saving ? 'Setting up…' : 'Set Password'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

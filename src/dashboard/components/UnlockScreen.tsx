import { Lock, Shield } from 'lucide-react';
import { BrandBanner } from '../../shared/BrandBanner.js';
import { UnlockForm } from '../../shared/components/UnlockForm.js';

interface UnlockScreenProps {
  onUnlocked: () => void;
}

export function UnlockScreen({ onUnlocked }: UnlockScreenProps) {
  return (
    <div className="relative flex min-h-screen bg-background">
      {/* Left form panel */}
      <section className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <BrandBanner className="mb-10 lg:hidden" imageClassName="h-12 w-auto" />

          <div className="mb-8">
            <h2 className="mb-2 text-2xl font-bold text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Enter your master password to decrypt your credentials and access the dashboard.
            </p>
          </div>

          <UnlockForm onUnlocked={onUnlocked} label="Master Password" />

          <p className="mt-6 hint">
            Your master password is never stored. It is used to derive the encryption key for your credentials.
          </p>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <Lock className="h-3 w-3" />
            <span>Encrypted locally</span>
          </div>
        </div>
      </section>

      {/* Right hero panel */}
      <section className="relative hidden items-center justify-center overflow-hidden lg:flex lg:w-1/2">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
        <div className="absolute -left-20 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-10 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative z-10 max-w-md px-12">
          <BrandBanner className="mb-8" imageClassName="h-14 w-auto" />

          <h1 className="mb-4 text-4xl font-bold leading-tight text-foreground">
            Your portfolio, <span className="text-primary">your data</span>
          </h1>
          <p className="mb-8 text-lg leading-relaxed text-muted-foreground">
            Track your P2P lending investments across platforms — securely and privately.
          </p>

          <div className="space-y-4">
            {[
              { icon: Lock, text: 'Encrypted storage with AES-256-GCM' },
              { icon: Shield, text: 'No cloud — everything stays local' },
              { icon: Lock, text: 'Local-only data processing' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

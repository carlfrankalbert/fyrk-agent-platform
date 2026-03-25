import { useState } from 'react'
import { api } from '../lib/api'

interface Props {
  onLogin: (email: string, code: string) => Promise<void>
}

export function AuthScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const handleSendCode = async () => {
    setSending(true)
    setError('')
    try {
      await api.sendCode(email)
      setStep('code')
    } catch {
      setError('Kunne ikke sende kode')
    } finally {
      setSending(false)
    }
  }

  const handleVerify = async () => {
    setSending(true)
    setError('')
    try {
      await onLogin(email, code)
    } catch {
      setError('Ugyldig eller utlopt kode')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center justify-center w-full h-full auth-bg">
      <div className="w-[420px]">
        {/* Card */}
        <div className="bg-hub-card/95 backdrop-blur-sm border border-white/[0.07] rounded-card shadow-card p-10">
          {/* Logo / Brand */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-[14px] bg-hub-accent/12 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-hub-accent">
                <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium text-hub-text tracking-wide">HUSMOR HUB</span>
          </div>

          <p className="text-hub-muted text-sm mb-8">Logg inn for a se familiedashboardet</p>

          {step === 'email' ? (
            <div className="space-y-4">
              <div>
                <label className="label block mb-1.5">E-post</label>
                <input
                  type="email"
                  placeholder="navn@eksempel.no"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && email && handleSendCode()}
                  className="w-full px-4 py-3 bg-hub-bg border border-white/[0.07] rounded-inner text-sm text-hub-text placeholder-hub-muted/40 focus-ring transition-colors focus:border-hub-accent/50"
                  autoFocus
                />
              </div>
              <button
                onClick={handleSendCode}
                disabled={!email || sending}
                className="w-full py-3 bg-hub-accent hover:bg-hub-accent/90 text-white rounded-inner text-sm font-medium disabled:opacity-30 transition-all focus-ring"
              >
                {sending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Sender...
                  </span>
                ) : (
                  'Send innloggingskode'
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-hub-bg/50 rounded-inner border border-white/[0.06]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-hub-muted flex-shrink-0">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-xs text-hub-muted">Koden er sendt via Slack</span>
              </div>

              <div>
                <label className="label block mb-1.5">Bekreftelseskode</label>
                <input
                  type="text"
                  placeholder="------"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && handleVerify()}
                  className="w-full px-4 py-3 bg-hub-bg border border-white/[0.07] rounded-inner text-hub-text text-center text-2xl tracking-[0.4em] font-mono placeholder:tracking-[0.3em] placeholder:text-hub-muted/20 placeholder:text-lg focus-ring transition-colors focus:border-hub-accent/50"
                  autoFocus
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={code.length !== 6 || sending}
                className="w-full py-3 bg-hub-accent hover:bg-hub-accent/90 text-white rounded-inner text-sm font-medium disabled:opacity-30 transition-all focus-ring"
              >
                {sending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Verifiserer...
                  </span>
                ) : (
                  'Logg inn'
                )}
              </button>

              <button
                onClick={() => { setStep('email'); setCode(''); setError('') }}
                className="w-full py-2 text-hub-muted text-xs hover:text-hub-text transition-colors focus-ring rounded-inner"
              >
                Bruk en annen e-postadresse
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-inner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-hub-red flex-shrink-0">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-xs text-hub-red">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-4">
          <span className="text-[10px] text-hub-muted/30">Husmor Hub &middot; FYRK</span>
        </div>
      </div>
    </div>
  )
}

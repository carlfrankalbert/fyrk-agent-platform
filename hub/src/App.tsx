import { useAuth } from './hooks/useAuth'
import { useWakeLock } from './hooks/useWakeLock'
import { AuthScreen } from './components/AuthScreen'
import { Layout } from './components/Layout'

export default function App() {
  const auth = useAuth()
  useWakeLock()

  if (auth.loading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-hub-bg">
        <div className="text-hub-muted text-lg">Laster...</div>
      </div>
    )
  }

  if (!auth.authenticated) {
    return <AuthScreen onLogin={auth.login} />
  }

  return <Layout email={auth.email!} onLogout={auth.logout} />
}

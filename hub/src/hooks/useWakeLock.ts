import { useEffect } from 'react'

/** Keep iPad screen on while the hub is visible */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null

    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen')
        }
      } catch {
        // Wake lock denied or not supported — fine
      }
    }

    acquire()

    // Re-acquire when returning from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      lock?.release()
    }
  }, [])
}

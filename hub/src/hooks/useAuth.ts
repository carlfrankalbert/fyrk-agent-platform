import { useState, useEffect, useCallback } from 'react';
import { api, hasToken, setToken, clearToken } from '../lib/api';

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  email: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    email: null,
  });

  useEffect(() => {
    if (!hasToken()) {
      setState({ loading: false, authenticated: false, email: null });
      return;
    }
    api.me()
      .then((data) => setState({ loading: false, authenticated: true, email: data.email }))
      .catch(() => {
        clearToken();
        setState({ loading: false, authenticated: false, email: null });
      });
  }, []);

  const login = useCallback(async (email: string, code: string) => {
    const result = await api.verifyCode(email, code);
    setToken(result.token);
    setState({ loading: false, authenticated: true, email });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setState({ loading: false, authenticated: false, email: null });
  }, []);

  return { ...state, login, logout };
}

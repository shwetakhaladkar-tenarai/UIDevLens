import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as authApi from "../services/authApi.js";

const AuthContext = createContext(null);

/**
 * Session state, lifted above the router (see App.jsx) same as
 * AuditRunContext — checks for an existing session cookie once on mount so
 * a page refresh doesn't bounce an already-logged-in user back to /login.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until the initial /me check resolves

  useEffect(() => {
    let cancelled = false;
    authApi
      .fetchMe()
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const u = await authApi.login(email, password);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (email, password, name) => {
    const u = await authApi.register(email, password, name);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const updateProfile = useCallback(async (updates) => {
    const u = await authApi.updateProfile(updates);
    setUser(u);
    return u;
  }, []);

  const value = { user, loading, login, register, logout, updateProfile };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

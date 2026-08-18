"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthCtx>(null!);

const TOKEN_KEY = "arc_vault_token";
const REFRESH_KEY = "arc_vault_refresh_token";
const USER_KEY = "arc_vault_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedToken && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        setToken(savedToken);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
    setLoading(false);

    const handleForceLogout = () => {
      setToken(null);
      setUser(null);
    };
    // api.ts sessizce token yenilediğinde context'i güncel tut.
    const handleRefreshed = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.token) setToken(data.token);
      if (data?.user) setUser(data.user);
    };
    window.addEventListener("arc_vault_logout", handleForceLogout);
    window.addEventListener("arc_vault_refreshed", handleRefreshed);
    return () => {
      window.removeEventListener("arc_vault_logout", handleForceLogout);
      window.removeEventListener("arc_vault_refreshed", handleRefreshed);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { getApiBase } = await import("./api");
    const base = getApiBase();
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Giriş başarısız");
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem(TOKEN_KEY, data.token);
    if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    if (refreshToken) {
      // Sunucudaki refresh token'ı da iptal et; cevabı beklemeye gerek yok.
      import("./api").then(({ getApiBase }) =>
        fetch(`${getApiBase()}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        }).catch(() => {}),
      );
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

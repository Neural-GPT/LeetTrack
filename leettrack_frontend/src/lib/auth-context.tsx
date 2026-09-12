"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearTokens, getRole, storeTokens, type TokenPair } from "@/lib/api";

type Role = TokenPair["role"];

type AuthContextValue = {
  role: Role | null;
  isLoading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  completeStudentRegistration: (email: string, otp: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ROLE_HOME: Record<Role, string> = {
  student: "/dashboard",
  teacher: "/teacher",
  super_admin: "/admin",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setRole(getRole());
    setIsLoading(false);
  }, []);

  async function login(usernameOrEmail: string, password: string) {
    const tokens = await api.post<TokenPair>("/api/auth/login", {
      username_or_email: usernameOrEmail,
      password,
    });
    storeTokens(tokens);
    setRole(tokens.role);
    router.push(ROLE_HOME[tokens.role]);
  }

  async function completeStudentRegistration(email: string, otp: string) {
    const tokens = await api.post<TokenPair>("/api/auth/register/student/verify-otp", {
      email,
      otp,
    });
    storeTokens(tokens);
    setRole(tokens.role);
    router.push(ROLE_HOME[tokens.role]);
  }

  function logout() {
    clearTokens();
    setRole(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider
      value={{ role, isLoading, login, completeStudentRegistration, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

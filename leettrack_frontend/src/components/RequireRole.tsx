"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type Role = "student" | "teacher" | "super_admin";

export default function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}) {
  const { role, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!role || !roles.includes(role)) {
      router.replace("/login");
    }
  }, [isLoading, role, roles, router]);

  if (isLoading || !role || !roles.includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-secondary text-sm">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}

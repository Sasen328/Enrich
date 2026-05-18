import { useEffect } from "react";
import { useLocation } from "wouter";

export default function CompaniesPage() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/meshbase");
  }, [setLocation]);
  return null;
}

// §9 — Theme flash overlay: brief lavender bloom on theme switch.
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeFlash() {
  const { resolvedTheme } = useTheme();
  const [flash, setFlash] = useState(false);
  const [last, setLast] = useState<string | undefined>(resolvedTheme);

  useEffect(() => {
    if (resolvedTheme && last && resolvedTheme !== last) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
    setLast(resolvedTheme);
    return undefined;
  }, [resolvedTheme, last]);

  if (!flash) return null;
  return <div className="theme-flash" aria-hidden />;
}

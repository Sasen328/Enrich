# Nix packages for ProspectSA on Replit (fallback if modules don't cover them).
{ pkgs }: {
  deps = [
    pkgs.nodejs_24
    pkgs.nodePackages.pnpm
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.uv
    pkgs.postgresql_16
    # Headless Chromium + libs for Playwright / power-scraper L2–L3:
    pkgs.chromium
  ];
  env = {
    # Point Playwright/Puppeteer at the Nix Chromium instead of downloading one.
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
    PUPPETEER_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
    PUPPETEER_SKIP_DOWNLOAD = "true";
  };
}

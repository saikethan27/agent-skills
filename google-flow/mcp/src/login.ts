#!/usr/bin/env node
// One-time setup: opens the dedicated Chrome profile on Flow so the user can sign in by hand.
import { CDP_PORT, getFlowPage, PROFILE_DIR } from "./chrome.js";
import { IS_WIN, powershell } from "./platform.js";

if (IS_WIN) {
  // If a background tool or service started Chrome on CDP_PORT without a visible desktop window, stop it first
  // so launchChrome() opens a visible window in the user's interactive session.
  try {
    powershell(
      `$c = Get-NetTCPConnection -LocalPort ${CDP_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -eq 0) { Stop-Process -Id $p.Id -Force; Start-Sleep -Milliseconds 500 } }`,
    );
  } catch {
    // Ignore and proceed to getFlowPage()
  }
}

const page = await getFlowPage();
await page.bringToFront();
console.log(`Chrome is open on ${page.url()}`);
console.log(`Profile: ${PROFILE_DIR}`);
console.log("Sign in to Google in that window, then open or create a Flow project. The session is kept for next time.");
process.exit(0);

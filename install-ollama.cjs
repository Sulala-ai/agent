#!/usr/bin/env node

/**
 * Install Ollama and enable auto-start on boot.
 * Run with admin/sudo privileges: node install-ollama.cjs
 * Prerequisites: Node.js v18+
 */

const { execSync } = require("child_process");
const os = require("os");
const platform = os.platform();

function run(cmd, opts = { stdio: "inherit" }) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, opts);
}

function isInstalled(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("🚀 Installing & enabling Ollama auto-start...");

if (platform === "darwin") {
  // macOS
  if (!isInstalled("which ollama")) {
    run("brew install ollama");
  }
  run("brew services start ollama");
  console.log("✅ Ollama installed and set to auto-start on macOS");
} else if (platform === "linux") {
  // Linux
  if (!isInstalled("which ollama")) {
    run("curl -fsSL https://ollama.com/install.sh | sh");
  }
  run("sudo systemctl enable ollama");
  run("sudo systemctl start ollama");
  console.log("✅ Ollama installed and set to auto-start on Linux");
} else if (platform === "win32") {
  // Windows
  if (!isInstalled("where ollama")) {
    run(
      `powershell -Command "Invoke-WebRequest https://ollama.com/download/OllamaSetup.exe -OutFile OllamaSetup.exe; Start-Process OllamaSetup.exe -Wait"`,
      { shell: true }
    );
  }
  run(
    `powershell -Command "$startup = [Environment]::GetFolderPath('Startup'); $target = 'C:\\Program Files\\Ollama\\ollama.exe'; $link = Join-Path $startup 'Ollama.lnk'; $wsh = New-Object -ComObject WScript.Shell; $shortcut = $wsh.CreateShortcut($link); $shortcut.TargetPath = $target; $shortcut.Save();"`,
    { shell: true }
  );
  console.log("✅ Ollama installed and set to auto-start on Windows");
} else {
  console.error("❌ Unsupported OS:", platform);
  process.exit(1);
}

console.log("\n🎉 Ollama is ready and will auto-start on boot!");
console.log("   Verify: ollama list  or  curl http://localhost:11434");

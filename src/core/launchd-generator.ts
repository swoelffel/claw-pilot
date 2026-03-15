// src/core/launchd-generator.ts

export interface LaunchdDashboardOptions {
  nodeBin: string;
  clawPilotBin: string;
  port: number;
  home: string;
}

export function generateDashboardLaunchdPlist(options: LaunchdDashboardOptions): string {
  const { nodeBin, clawPilotBin, port, home } = options;
  const logPath = `${home}/.claw-pilot/dashboard.log`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.claw-pilot.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${clawPilotBin}</string>
    <string>dashboard</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:${home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

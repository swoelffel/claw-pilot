// src/core/systemd-generator.ts

export interface DashboardServiceOptions {
  nodeBin: string; // absolute path to node binary, e.g. /usr/local/bin/node
  clawPilotBin: string; // absolute path to dist/index.mjs, e.g. /opt/claw-pilot/dist/index.mjs
  port: number; // dashboard port, default 19000
  home: string; // user home dir, e.g. /home/user
  uid: number; // user UID, e.g. 1000
  username: string; // OS username — used for User=/Group= in the system service
}

export function generateDashboardService(options: DashboardServiceOptions): string {
  const { nodeBin, clawPilotBin, port, home, uid, username } = options;
  const xdgRuntimeDir = `/run/user/${uid}`;

  return `[Unit]
Description=Claw Pilot Dashboard (port ${port})
After=network-online.target
Wants=network-online.target

[Service]
User=${username}
Group=${username}
ExecStart=${nodeBin} ${clawPilotBin} dashboard --port ${port}
Restart=always
RestartSec=5
KillMode=process
StandardOutput=journal
StandardError=journal
Environment=HOME=${home}
Environment=PATH=${home}/.local/bin:${home}/.local/share/pnpm:${home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=XDG_RUNTIME_DIR=${xdgRuntimeDir}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
}

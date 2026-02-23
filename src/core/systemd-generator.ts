// src/core/systemd-generator.ts
import { constants } from "../lib/constants.js";

export interface SystemdOptions {
  slug: string;
  displayName: string;
  port: number;
  stateDir: string;
  configPath: string;
  openclawHome: string;
  openclawBin: string;
}

export function generateSystemdService(options: SystemdOptions): string {
  const {
    slug,
    displayName,
    port,
    stateDir,
    configPath,
    openclawHome,
    openclawBin,
  } = options;

  return `[Unit]
Description=OpenClaw Gateway - Instance ${slug} (${displayName})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${openclawBin} gateway --port ${port} --profile ${slug}
Restart=always
RestartSec=5
KillMode=process
StandardOutput=append:${stateDir}/logs/gateway.log
StandardError=append:${stateDir}/logs/gateway.log
Environment=HOME=${openclawHome}
Environment=PATH=${openclawHome}/.local/bin:${openclawHome}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=OPENCLAW_PROFILE=${slug}
Environment=OPENCLAW_STATE_DIR=${stateDir}
Environment=OPENCLAW_CONFIG_PATH=${configPath}
Environment=OPENCLAW_GATEWAY_PORT=${port}
Environment=OPENCLAW_SYSTEMD_UNIT=openclaw-${slug}.service
Environment=OPENCLAW_SERVICE_MARKER=openclaw
Environment=OPENCLAW_SERVICE_KIND=gateway
Environment=XDG_RUNTIME_DIR=${constants.XDG_RUNTIME_DIR}

[Install]
WantedBy=default.target
`;
}

export interface DashboardServiceOptions {
  nodeBin: string;       // absolute path to node binary, e.g. /usr/local/bin/node
  clawPilotBin: string;  // absolute path to dist/index.mjs, e.g. /opt/claw-pilot/dist/index.mjs
  port: number;          // dashboard port, default 19000
  home: string;          // user home dir, e.g. /home/freebox
  uid: number;           // user UID, e.g. 1000
}

export function generateDashboardService(options: DashboardServiceOptions): string {
  const { nodeBin, clawPilotBin, port, home, uid } = options;
  const xdgRuntimeDir = `/run/user/${uid}`;

  return `[Unit]
Description=Claw Pilot Dashboard (port ${port})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${nodeBin} ${clawPilotBin} dashboard --port ${port}
Restart=always
RestartSec=5
KillMode=process
StandardOutput=journal
StandardError=journal
Environment=HOME=${home}
Environment=PATH=${home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=XDG_RUNTIME_DIR=${xdgRuntimeDir}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

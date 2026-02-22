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

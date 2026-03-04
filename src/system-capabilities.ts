/**
 * System capabilities for Ollama suitability: storage, cloud detection.
 * Used by onboarding to warn or disable Ollama on cloud/weak devices.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { platform } from 'os';

const MIN_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB for Ollama + models

function getFreeDiskBytes(): number | null {
  try {
    if (platform() === 'win32') {
      const out = execSync('wmic logicaldisk get FreeSpace,DeviceID', { encoding: 'utf8', timeout: 3000 });
      const lines = out.trim().split(/\r?\n/).slice(1);
      let total = 0;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const free = parseInt(parts[0], 10);
          if (!Number.isNaN(free)) total += free;
        }
      }
      return total > 0 ? total : null;
    }
    const out = execSync('df -k . 2>/dev/null | tail -1', { encoding: 'utf8', timeout: 3000 });
    const parts = out.trim().split(/\s+/);
    const avail = parseInt(parts[3], 10); // 4th column is available 1K blocks
    if (!Number.isNaN(avail) && avail >= 0) return avail * 1024;
  } catch {
    // ignore
  }
  return null;
}

function isCloudOrContainer(): { cloud: boolean; reason: string } {
  const env = process.env;
  if (env.AWS_EXECUTION_ENV || env.AWS_LAMBDA_FUNCTION_NAME) return { cloud: true, reason: 'AWS Lambda' };
  if (env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT) return { cloud: true, reason: 'Google Cloud' };
  if (Object.keys(env).some((k) => k.startsWith('AZURE_'))) return { cloud: true, reason: 'Azure' };
  if (env.KUBERNETES_SERVICE_HOST) return { cloud: true, reason: 'Kubernetes' };
  if (env.DOCKER === 'true' || env.CONTAINER === 'true') return { cloud: true, reason: 'Container' };
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') return { cloud: true, reason: 'CI/CD' };
  if (env.CODESPACES === 'true') return { cloud: true, reason: 'GitHub Codespaces' };
  try {
    if (platform() === 'linux') {
      const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
        return { cloud: true, reason: 'Container (cgroup)' };
      }
    }
  } catch {
    // ignore
  }
  return { cloud: false, reason: '' };
}

export type SystemCapabilities = {
  storageFreeBytes: number | null;
  isCloudOrContainer: boolean;
  cloudReason: string;
  ollamaSuitable: boolean;
  ollamaSuitableReason: string;
};

export function getSystemCapabilities(): SystemCapabilities {
  const free = getFreeDiskBytes();
  const { cloud, reason } = isCloudOrContainer();

  if (cloud) {
    return {
      storageFreeBytes: free,
      isCloudOrContainer: true,
      cloudReason: reason,
      ollamaSuitable: false,
      ollamaSuitableReason: `Not recommended: Running in ${reason}. Ollama requires a local machine with sufficient storage and compute.`,
    };
  }

  if (free != null && free < MIN_STORAGE_BYTES) {
    return {
      storageFreeBytes: free,
      isCloudOrContainer: false,
      cloudReason: '',
      ollamaSuitable: false,
      ollamaSuitableReason: `Insufficient storage: ${(free / 1024 / 1024 / 1024).toFixed(1)}GB free. Ollama needs at least 5GB.`,
    };
  }

  return {
    storageFreeBytes: free,
    isCloudOrContainer: false,
    cloudReason: '',
    ollamaSuitable: true,
    ollamaSuitableReason: free != null ? `${(free / 1024 / 1024 / 1024).toFixed(1)}GB free` : 'Storage check unavailable',
  };
}

/** Parse model size string like "~4.2GB" or "~1.6GB" to bytes. Returns null if unparseable. */
export function parseModelSizeToBytes(sizeStr: string): number | null {
  if (!sizeStr || typeof sizeStr !== 'string') return null;
  const m = sizeStr.match(/~?(\d+(?:\.\d+)?)\s*(GB|MB|gb|mb)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'GB') return Math.round(val * 1024 * 1024 * 1024);
  if (unit === 'MB') return Math.round(val * 1024 * 1024);
  return null;
}

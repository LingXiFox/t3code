import { QUOTA_PLATFORM_ORDER, type QuotaPlatformId } from "./types";

const METRICS_PREFERENCES_STORAGE_KEY = "lingxi:metrics-bar-preferences:v1";

export interface MetricsBarPreferences {
  readonly visible: boolean;
  readonly enabledPlatforms: readonly QuotaPlatformId[];
  readonly platformOrder: readonly QuotaPlatformId[];
  readonly autoRefresh: boolean;
}

export const DEFAULT_METRICS_PREFERENCES: MetricsBarPreferences = {
  visible: true,
  enabledPlatforms: [...QUOTA_PLATFORM_ORDER],
  platformOrder: [...QUOTA_PLATFORM_ORDER],
  autoRefresh: true,
};

const VALID_PLATFORMS = new Set<string>(QUOTA_PLATFORM_ORDER);

function isQuotaPlatformId(value: unknown): value is QuotaPlatformId {
  return typeof value === "string" && VALID_PLATFORMS.has(value);
}

export function sanitizeMetricsPreferences(raw: unknown): MetricsBarPreferences {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_METRICS_PREFERENCES;
  }
  const record = raw as Record<string, unknown>;
  const visible = typeof record.visible === "boolean" ? record.visible : true;
  const autoRefresh = typeof record.autoRefresh === "boolean" ? record.autoRefresh : true;

  const seenOrder = new Set<QuotaPlatformId>();
  const platformOrder: QuotaPlatformId[] = [];
  if (Array.isArray(record.platformOrder)) {
    for (const id of record.platformOrder) {
      if (isQuotaPlatformId(id) && !seenOrder.has(id)) {
        seenOrder.add(id);
        platformOrder.push(id);
      }
    }
  }
  for (const id of QUOTA_PLATFORM_ORDER) {
    if (!seenOrder.has(id)) {
      platformOrder.push(id);
    }
  }

  let enabledPlatforms: QuotaPlatformId[];
  if (Array.isArray(record.enabledPlatforms)) {
    const enabledSet = new Set<QuotaPlatformId>();
    for (const id of record.enabledPlatforms) {
      if (isQuotaPlatformId(id)) {
        enabledSet.add(id);
      }
    }
    enabledPlatforms = platformOrder.filter((id) => enabledSet.has(id));
  } else {
    enabledPlatforms = [...platformOrder];
  }

  return {
    visible,
    enabledPlatforms,
    platformOrder,
    autoRefresh,
  };
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSnapshot: MetricsBarPreferences = DEFAULT_METRICS_PREFERENCES;

export function getMetricsPreferencesSnapshot(): MetricsBarPreferences {
  if (typeof window === "undefined") return DEFAULT_METRICS_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(METRICS_PREFERENCES_STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedSnapshot = raw
        ? sanitizeMetricsPreferences(JSON.parse(raw))
        : DEFAULT_METRICS_PREFERENCES;
    }
    return cachedSnapshot;
  } catch {
    return DEFAULT_METRICS_PREFERENCES;
  }
}

function writeMetricsPreferences(next: MetricsBarPreferences): MetricsBarPreferences {
  const sanitized = sanitizeMetricsPreferences(next);
  if (typeof window !== "undefined") {
    try {
      const serialized = JSON.stringify(sanitized);
      window.localStorage.setItem(METRICS_PREFERENCES_STORAGE_KEY, serialized);
      cachedRaw = serialized;
      cachedSnapshot = sanitized;
    } catch {
      // Ignore storage quota errors cleanly.
    }
  }
  for (const listener of listeners) {
    listener();
  }
  return sanitized;
}

export function updateMetricsPreferences(
  patch: Partial<MetricsBarPreferences>,
): MetricsBarPreferences {
  const current = getMetricsPreferencesSnapshot();
  return writeMetricsPreferences({
    ...current,
    ...patch,
  });
}

export function subscribeMetricsPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

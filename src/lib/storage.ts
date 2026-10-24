// Small wrappers so a blocked or full storage never breaks the app.

export function load<T>(key: string, fallback: T, store: Storage = localStorage): T {
  try {
    const raw = store.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown, store: Storage = localStorage): void {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or quota; the app still works for this session.
  }
}

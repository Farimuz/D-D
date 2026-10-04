// Plain HTTP on phones may not expose randomUUID. These are local identities only.
export function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

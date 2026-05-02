const KEY = "mallmind_anon_uid";

export function getAnonymousUserId(): string {
  let uid = localStorage.getItem(KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(KEY, uid);
  }
  return uid;
}

export interface AppUser {
  username: string;
  passwordHash: string;
}

export function loadUsers(): AppUser[] {
  const raw = process.env.APP_USERS ?? ""; // format: "user1:hash1,user2:hash2"
  return raw
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [username, passwordHash] = entry.split(":");
      return { username, passwordHash };
    });
}

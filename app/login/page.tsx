"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError("Usuário ou senha inválidos");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuário" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="senha" />
      <button type="submit">Entrar</button>
      {error && <p>{error}</p>}
    </form>
  );
}

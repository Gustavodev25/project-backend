import { jwtVerify, type JWTPayload } from "jose";

export interface SessionPayload extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
}

export function getAuthSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET não configurado. Defina a variável de ambiente antes de usar autenticação.",
    );
  }
  return secret;
}

export async function tryVerifySessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(getAuthSecret());
    const { payload } = await jwtVerify(token, secret);

    if (!payload || typeof payload === "string" || !payload.sub) return null;
    return payload as SessionPayload;
  } catch (error) {
    console.error(
      "Erro ao verificar token de sessão:",
      (error as Error)?.message,
    );
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload> {
  const session = await tryVerifySessionToken(token);
  if (!session) throw new Error("Sessão inválida ou expirada.");
  return session;
}

export async function assertSessionToken(token: string | undefined): Promise<SessionPayload> {
  const session = await tryVerifySessionToken(token);
  if (!session) throw new Error("Sessão inválida ou expirada.");
  return session;
}

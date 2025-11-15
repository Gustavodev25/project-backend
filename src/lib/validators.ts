// src/lib/validators.ts
import { z } from "zod";

// Países permitidos (alfa-2) + vazio -> transforma "" em null
export const CountrySchema = z
  .union([
    z.literal(""),
    z.enum([
      "BR",
      "PT",
      "US",
      "CA",
      "MX",
      "AR",
      "CL",
      "CO",
      "PE",
      "UY",
      "PY",
      "BO",
      "EC",
      "VE",
      "ES",
      "FR",
      "DE",
      "IT",
      "UK",
      "JP",
      "CN",
      "KR",
      "IN",
      "AU",
      "OTHER",
    ]),
  ])
  .transform((v) => (v === "" ? null : v));

const passwordStrong = (v: string) =>
  v.length >= 8 &&
  /[a-z]/.test(v) &&
  /[A-Z]/.test(v) &&
  /\d/.test(v) &&
  /[^A-Za-z0-9]/.test(v);

// Para reuso quando precisar forçar senha forte (ex.: cadastro, troca de senha)
export const StrongPasswordSchema = z
  .string()
  .min(8, "Senha precisa de 8+ caracteres")
  .max(72, "Senha muito longa") // bcrypt usa os 72 primeiros chars
  .refine(
    passwordStrong,
    "Senha fraca: use maiúscula, minúscula, número e símbolo (8+).",
  );

// Cadastro
export const RegisterSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto"),
  email: z.string().trim().toLowerCase().email("Email inválido"),
  senha: StrongPasswordSchema,
  pais: CountrySchema,
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// Login (não exige força, só presença e limite de 72 chars)
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido"),
  senha: z.string().min(1, "Informe a senha").max(72, "Senha muito longa"),
});
export type LoginInput = z.infer<typeof LoginSchema>;

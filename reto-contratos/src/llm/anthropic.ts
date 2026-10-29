import { createAnthropic } from "@ai-sdk/anthropic"
import type { ProveedorLLM } from "./adapter"

const MODELO = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5"

/** Implementación para Anthropic. La clave se lee SOLO de ANTHROPIC_API_KEY en el servidor. */
export const anthropicProveedor: ProveedorLLM = {
  nombre: "anthropic",
  modelo: MODELO,
  configurado: () => Boolean(process.env.ANTHROPIC_API_KEY),
  crearModelo: () => createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(MODELO),
}

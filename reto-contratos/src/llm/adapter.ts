import type { LanguageModel } from "ai"

/**
 * Interfaz propia del proveedor de IA. El ciclo del agente (app/api/chat)
 * solo conoce esta interfaz: cambiar de proveedor = escribir otra
 * implementación (openai.ts, azure.ts...) y cambiar una línea en proveedor.ts.
 */
export interface ProveedorLLM {
  nombre: string
  modelo: string
  /** true si la clave está configurada en el servidor (nunca se expone su valor). */
  configurado(): boolean
  crearModelo(): LanguageModel
}

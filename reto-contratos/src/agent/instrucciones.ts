import { leerArchivo } from "../lib/fuente"

/** System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge). */
export function cargarInstrucciones(directorio: string): string {
  const prompt = leerArchivo(directorio, "agent/prompt.md") ?? "Eres un agente de registro de contratos."
  const conocimiento = leerArchivo(directorio, "src/knowledge/registro-contratos.md") ?? ""
  const hoy = new Date().toISOString().slice(0, 10)
  return `${prompt}\n\n---\n\n${conocimiento}\n\n---\nFecha actual del sistema: ${hoy}`
}

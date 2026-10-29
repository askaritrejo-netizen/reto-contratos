import fs from "node:fs"
import path from "node:path"
import { carpetaSalida } from "../lib/almacen"

/** Sesiones guardadas como archivo (una por conversación) dentro de la carpeta de salida. */
function ruta(directorio: string, id: string): string {
  const seguro = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "sin-id"
  return path.join(carpetaSalida(directorio), "sesiones", `${seguro}.json`)
}

export function guardarSesion(directorio: string, id: string, mensajes: unknown): void {
  try {
    const destino = ruta(directorio, id)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, JSON.stringify(mensajes, null, 2))
  } catch {
    // Guardar la sesión es opcional: nunca debe romper el chat.
  }
}

export function leerSesion(directorio: string, id: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(ruta(directorio, id), "utf8")) as unknown
  } catch {
    return null
  }
}

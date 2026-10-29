import fs from "node:fs"
import path from "node:path"
import { ARCHIVOS } from "../generated/archivos"

/**
 * Lectura de archivos de solo lectura (fixtures, prompt, conocimiento).
 * Primero intenta el disco; si el archivo no está (por ejemplo en un servidor
 * donde no se copiaron), usa la copia empaquetada por scripts/empaquetar.ts.
 */
export function leerArchivo(directorio: string, relativa: string): string | null {
  try {
    return fs.readFileSync(path.join(directorio, relativa), "utf8")
  } catch {
    return ARCHIVOS[relativa] ?? null
  }
}

export const RUTA_BUZON = "fixtures/reto-02/buzon"
export const RUTA_MAESTRO_FIXTURE = "fixtures/reto-02/maestro-contratos.csv"
export const RUTA_COMERCIALES = "fixtures/reto-02/comerciales.json"

/** Lista los ids de mensaje (carpetas) del buzón, ordenados. */
export function listarMensajes(directorio: string): string[] {
  try {
    return fs
      .readdirSync(path.join(directorio, RUTA_BUZON), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    const prefijo = `${RUTA_BUZON}/`
    const ids = Object.keys(ARCHIVOS)
      .filter((k) => k.startsWith(prefijo))
      .map((k) => k.slice(prefijo.length).split("/")[0])
    return [...new Set(ids)].sort()
  }
}

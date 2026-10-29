import fs from "node:fs"
import path from "node:path"
import { COLUMNAS_MAESTRO, type FilaMaestro } from "./esquema"
import { leerArchivo, RUTA_MAESTRO_FIXTURE } from "./fuente"

/**
 * "SharePoint simulado". Todo lo que se escribe vive en la carpeta de salida:
 * - local: <proyecto>/out
 * - en Vercel: /tmp/reto-02-out (es la única carpeta con permiso de escritura)
 * El fixture original nunca se modifica (RN6).
 */
export function carpetaSalida(directorio: string): string {
  if (process.env.OUT_DIR) return process.env.OUT_DIR
  if (process.env.VERCEL) return "/tmp/reto-02-out"
  return path.join(directorio, "out")
}

function asegurarCarpeta(ruta: string): void {
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
}

export function rutaSalida(directorio: string, relativa: string): string {
  return path.join(carpetaSalida(directorio), relativa)
}

// ---------- CSV ----------

function escaparCsv(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

function partirLineaCsv(linea: string): string[] {
  const celdas: string[] = []
  let actual = ""
  let enComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (enComillas && c === '"' && linea[i + 1] === '"') {
      actual += '"'
      i++
    } else if (c === '"') {
      enComillas = !enComillas
    } else if (c === "," && !enComillas) {
      celdas.push(actual)
      actual = ""
    } else {
      actual += c
    }
  }
  celdas.push(actual)
  return celdas
}

export function parsearMaestro(csv: string): FilaMaestro[] {
  const lineas = csv.split(/\r?\n/).filter((l) => l.trim() !== "")
  const encabezado = partirLineaCsv(lineas[0] ?? "")
  return lineas.slice(1).map((linea) => {
    const celdas = partirLineaCsv(linea)
    const fila = {} as FilaMaestro
    for (const col of COLUMNAS_MAESTRO) {
      const i = encabezado.indexOf(col)
      fila[col] = i >= 0 ? (celdas[i] ?? "") : ""
    }
    return fila
  })
}

function serializarMaestro(filas: FilaMaestro[]): string {
  const lineas = [COLUMNAS_MAESTRO.join(",")]
  for (const f of filas) lineas.push(COLUMNAS_MAESTRO.map((c) => escaparCsv(f[c])).join(","))
  return lineas.join("\n") + "\n"
}

// ---------- Maestro ----------

export const REL_MAESTRO = "sharepoint/maestro-contratos.csv"

/** Primera ejecución: copia el fixture a la carpeta de salida (RN6). */
function inicializarMaestro(directorio: string): void {
  const destino = rutaSalida(directorio, REL_MAESTRO)
  if (fs.existsSync(destino)) return
  const original = leerArchivo(directorio, RUTA_MAESTRO_FIXTURE)
  if (original === null) throw new Error("No se encontró el maestro de contratos (fixture)")
  asegurarCarpeta(destino)
  fs.writeFileSync(destino, original)
}

export function leerMaestro(directorio: string): FilaMaestro[] {
  inicializarMaestro(directorio)
  return parsearMaestro(fs.readFileSync(rutaSalida(directorio, REL_MAESTRO), "utf8"))
}

export function guardarMaestro(directorio: string, filas: FilaMaestro[]): void {
  const destino = rutaSalida(directorio, REL_MAESTRO)
  asegurarCarpeta(destino)
  fs.writeFileSync(destino, serializarMaestro(filas))
}

// ---------- Archivos de apoyo ----------

export function escribirArchivo(directorio: string, relativa: string, contenido: string): void {
  const destino = rutaSalida(directorio, relativa)
  asegurarCarpeta(destino)
  fs.writeFileSync(destino, contenido)
}

function agregarLineaJson(directorio: string, relativa: string, objeto: object): void {
  const destino = rutaSalida(directorio, relativa)
  asegurarCarpeta(destino)
  fs.appendFileSync(destino, JSON.stringify(objeto) + "\n")
}

export function registrarLog(
  directorio: string,
  entrada: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string },
): void {
  agregarLineaJson(directorio, "log.jsonl", { ts: new Date().toISOString(), ...entrada })
}

export function registrarHistorial(
  directorio: string,
  entrada: { id_contrato: string; accion: string; cambios: object; mensaje_id: string },
): void {
  agregarLineaJson(directorio, "sharepoint/historial.jsonl", { ts: new Date().toISOString(), ...entrada })
}

export type EstadoProcesado = { estado: string; detalle: string; ts: string }

export function leerProcesados(directorio: string): Record<string, EstadoProcesado> {
  try {
    const crudo = fs.readFileSync(rutaSalida(directorio, "procesados.json"), "utf8")
    return JSON.parse(crudo) as Record<string, EstadoProcesado>
  } catch {
    return {}
  }
}

export function marcarProcesado(directorio: string, mensajeId: string, estado: string, detalle: string): void {
  const actuales = leerProcesados(directorio)
  actuales[mensajeId] = { estado, detalle, ts: new Date().toISOString() }
  escribirArchivo(directorio, "procesados.json", JSON.stringify(actuales, null, 2))
}

/** Borra toda la salida. Lo usa demo.ts para ser determinista. */
export function limpiarSalida(directorio: string): void {
  fs.rmSync(carpetaSalida(directorio), { recursive: true, force: true })
}

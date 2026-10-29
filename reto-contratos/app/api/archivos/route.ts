import fs from "node:fs"
import { leerMaestro, rutaSalida } from "@/src/lib/almacen"

export const runtime = "nodejs"

const PERMITIDOS: Record<string, string> = {
  maestro: "sharepoint/maestro-contratos.csv",
  historial: "sharepoint/historial.jsonl",
  alertas: "alertas.md",
  log: "log.jsonl",
  procesados: "procesados.json",
}

/** Deja ver el "SharePoint" simulado: /api/archivos?nombre=maestro|historial|alertas|log|procesados */
export function GET(req: Request): Response {
  const nombre = new URL(req.url).searchParams.get("nombre") ?? "maestro"
  const relativa = PERMITIDOS[nombre]
  if (!relativa) return new Response("Archivo no permitido", { status: 400 })
  const directorio = process.cwd()
  if (nombre === "maestro") leerMaestro(directorio)
  try {
    const contenido = fs.readFileSync(rutaSalida(directorio, relativa), "utf8")
    return new Response(contenido, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
  } catch {
    return new Response("(todavía no existe: se crea al procesar el buzón)", { headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
}

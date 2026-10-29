import { limpiarSalida } from "@/src/lib/almacen"

export const runtime = "nodejs"

/** Vuelve el SharePoint simulado a su estado inicial (útil para repetir la demo). */
export function POST(): Response {
  limpiarSalida(process.cwd())
  return Response.json({ ok: true })
}

import { proveedor } from "@/src/llm/proveedor"

export const runtime = "nodejs"

export function GET(): Response {
  return Response.json({ ok: true, provider: proveedor.nombre, model: proveedor.modelo, clave_configurada: proveedor.configurado() })
}

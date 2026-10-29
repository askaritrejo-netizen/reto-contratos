import { leerSesion } from "@/src/agent/sesiones"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const sesion = leerSesion(process.cwd(), id)
  return sesion === null ? Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 }) : Response.json({ ok: true, mensajes: sesion })
}

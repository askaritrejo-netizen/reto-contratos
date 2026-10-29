import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai"
import { herramientasIA } from "@/src/agent/herramientas-ia"
import { cargarInstrucciones } from "@/src/agent/instrucciones"
import { guardarSesion } from "@/src/agent/sesiones"
import { proveedor } from "@/src/llm/proveedor"

export const runtime = "nodejs"
export const maxDuration = 60

// Topes de costo configurables (PRD 8): pasos por turno y tamaño de la sesión.
const MAX_PASOS = Number(process.env.MAX_PASOS ?? 25)
const MAX_TOKENS_SESION = Number(process.env.MAX_TOKENS_SESION ?? 90000)
const MAX_TOKENS_RESPUESTA = Number(process.env.MAX_TOKENS_RESPUESTA ?? 4096)

function textoError(mensaje: string, estado: number): Response {
  return new Response(mensaje, { status: estado, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

/** Traduce errores técnicos a lenguaje claro (CA5). Nunca incluye la clave. */
function mensajeClaro(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error)
  if (/abort|timeout/i.test(texto)) return "El modelo tardó demasiado en responder. Escribe 'continúa' para seguir donde quedó."
  if (/401|api key|authentication/i.test(texto)) return "La clave del modelo no es válida o no está configurada en el servidor."
  if (/429|rate limit|overloaded|529/i.test(texto)) return "El proveedor de IA está saturado en este momento. Intenta de nuevo en unos segundos."
  return `Ocurrió un error con el proveedor de IA: ${texto.slice(0, 200)}`
}

export async function POST(req: Request): Promise<Response> {
  let cuerpo: { id?: string; messages?: UIMessage[] }
  try {
    cuerpo = (await req.json()) as { id?: string; messages?: UIMessage[] }
  } catch {
    return textoError("Solicitud inválida.", 400)
  }
  const mensajes = cuerpo.messages ?? []
  const sessionId = cuerpo.id ?? "sin-id"
  const directorio = process.cwd()

  if (!proveedor.configurado()) {
    return textoError("Falta configurar ANTHROPIC_API_KEY en el servidor.", 500)
  }
  const tokensAprox = Math.ceil(JSON.stringify(mensajes).length / 4)
  if (tokensAprox > MAX_TOKENS_SESION) {
    return textoError("Esta conversación alcanzó el tope de uso. Abre una conversación nueva con el botón 'Nueva conversación'.", 429)
  }
  guardarSesion(directorio, sessionId, mensajes)

  const tools = herramientasIA({ directory: directorio, sessionId })
  const resultado = streamText({
    model: proveedor.crearModelo(),
    system: cargarInstrucciones(directorio),
    messages: await convertToModelMessages(mensajes, { tools }),
    tools,
    stopWhen: stepCountIs(MAX_PASOS),
    // CA1: en el último paso permitido ya no se usan herramientas; el agente responde con lo que tiene.
    prepareStep: ({ stepNumber }) => (stepNumber >= MAX_PASOS - 1 ? { toolChoice: "none" as const } : {}),
    maxOutputTokens: MAX_TOKENS_RESPUESTA,
    abortSignal: AbortSignal.timeout(55_000),
  })
  return resultado.toUIMessageStreamResponse({ onError: mensajeClaro })
}

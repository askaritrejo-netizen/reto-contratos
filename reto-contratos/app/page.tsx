"use client"

import { useChat } from "@ai-sdk/react"
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai"
import { useState, type FormEvent, type ReactNode } from "react"
import type { Contrato } from "@/src/lib/esquema"

const PROMPT_DEMO =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."

type ParteHerramienta = ToolUIPart | DynamicToolUIPart

// ---------------------------------------------------------------------------
// Texto con un mínimo de Markdown (tablas, negritas, títulos y viñetas)
// ---------------------------------------------------------------------------

function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((t, i) => {
    if (t.startsWith("**") && t.endsWith("**")) return <strong key={i}>{t.slice(2, -2)}</strong>
    if (t.startsWith("`") && t.endsWith("`")) return <code key={i}>{t.slice(1, -1)}</code>
    return <span key={i}>{t}</span>
  })
}

function Tabla({ lineas }: { lineas: string[] }) {
  const filas = lineas
    .filter((l) => !/^[\s|:-]+$/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
  const [encabezado, ...cuerpo] = filas
  return (
    <table>
      <thead>
        <tr>{encabezado?.map((c, i) => <th key={i}>{enLinea(c)}</th>)}</tr>
      </thead>
      <tbody>
        {cuerpo.map((f, i) => (
          <tr key={i}>{f.map((c, j) => <td key={j}>{enLinea(c)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

function Texto({ texto }: { texto: string }) {
  const bloques: ReactNode[] = []
  const lineas = texto.split("\n")
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    if (l.trim().startsWith("|")) {
      const grupo: string[] = []
      while (i < lineas.length && lineas[i].trim().startsWith("|")) grupo.push(lineas[i++])
      i--
      bloques.push(<Tabla key={i} lineas={grupo} />)
    } else if (/^#{1,4}\s/.test(l)) {
      bloques.push(<p key={i}><strong>{enLinea(l.replace(/^#+\s/, ""))}</strong></p>)
    } else if (l.trim() !== "") {
      bloques.push(<p key={i}>{enLinea(l)}</p>)
    }
  }
  return <div className="texto">{bloques}</div>
}

// ---------------------------------------------------------------------------
// Llamadas a herramientas y confirmación humana
// ---------------------------------------------------------------------------

function resumenSalida(salida: unknown): { ok: boolean; texto: string } {
  const r = salida as { ok?: boolean; error?: string; data?: Record<string, unknown> } | null
  if (!r || typeof r !== "object") return { ok: true, texto: String(salida) }
  if (r.ok === false) return { ok: false, texto: r.error ?? "Error" }
  const d = r.data ?? {}
  if (Array.isArray(d.mensajes)) return { ok: true, texto: `${d.mensajes.length} mensajes pendientes` }
  if (typeof d.clasificacion === "string") {
    const rev = Array.isArray(d.requiere_revision) && d.requiere_revision.length ? ` · revisar: ${d.requiere_revision.join(", ")}` : ""
    return { ok: true, texto: `${d.clasificacion}${rev}` }
  }
  if (typeof d.accion === "string") return { ok: true, texto: `${d.accion} ${String(d.id_contrato ?? "")}` }
  if (Array.isArray(d.vencen)) return { ok: true, texto: `${d.vencen.length} por vencer · ${Array.isArray(d.polizas_pendientes) ? d.polizas_pendientes.length : 0} pólizas pendientes` }
  if (typeof d.tipo_documento === "string") return { ok: true, texto: `${d.tipo_documento} ${String(d.id_contrato ?? "")}` }
  return { ok: true, texto: "listo" }
}

const CAMPOS_VISIBLES: Array<keyof Contrato> = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza", "comercial",
]

function TarjetaConfirmacion({ parte, responder }: { parte: ParteHerramienta; responder: (aprobado: boolean) => void }) {
  const entrada = (parte.input ?? {}) as { mensaje_id?: string; contrato?: Partial<Contrato> }
  const c = entrada.contrato ?? {}
  const confianza = c.confianza ?? {}
  return (
    <div className="confirmacion">
      <h3>Se requiere tu confirmación para registrar {entrada.mensaje_id ?? ""} en el maestro</h3>
      <table>
        <tbody>
          {CAMPOS_VISIBLES.map((campo) => {
            const conf = confianza[campo]
            const baja = typeof conf === "number" && conf < 0.8
            const valor = c[campo]
            return (
              <tr key={campo}>
                <td>{campo}</td>
                <td className={baja ? "baja" : undefined}>
                  {valor === null || valor === undefined || valor === "" ? "—" : String(valor)}
                  {typeof conf === "number" ? ` (confianza ${conf})` : ""}
                  {baja ? " ⚠ revisar" : ""}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {c.observaciones?.length ? <ul>{c.observaciones.map((o, i) => <li key={i}>{o}</li>)}</ul> : null}
      <div className="acciones">
        <button className="primario" onClick={() => responder(true)}>Confirmar y registrar</button>
        <button className="peligro" onClick={() => responder(false)}>Rechazar</button>
      </div>
    </div>
  )
}

function Herramienta({ parte, responder }: { parte: ParteHerramienta; responder: (id: string, aprobado: boolean) => void }) {
  const nombre = getToolName(parte)
  if (parte.state === "approval-requested") {
    return <TarjetaConfirmacion parte={parte} responder={(ok) => responder(parte.approval.id, ok)} />
  }
  let estado: ReactNode = <span>ejecutando…</span>
  if (parte.state === "output-available") {
    const r = resumenSalida(parte.output)
    estado = <span className={r.ok ? "estado-ok" : "estado-error"}>{r.ok ? "✓" : "✗"} {r.texto}</span>
  } else if (parte.state === "output-error") {
    estado = <span className="estado-error">✗ {parte.errorText}</span>
  } else if (parte.state === "output-denied") {
    estado = <span className="estado-error">✗ rechazado por la persona</span>
  } else if (parte.state === "approval-responded") {
    estado = <span>{parte.approval.approved ? "confirmado, registrando…" : "rechazado"}</span>
  }
  return (
    <div className="herramienta">
      <div>🔧 <span className="nombre">{nombre}</span> — {estado}</div>
      <details>
        <summary>argumentos y resultado</summary>
        <pre>{JSON.stringify(parte.input, null, 2)}</pre>
        {parte.state === "output-available" ? <pre>{JSON.stringify(parte.output, null, 2)}</pre> : null}
      </details>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function Chat({ id, nuevaConversacion }: { id: string; nuevaConversacion: () => void }) {
  const [entrada, setEntrada] = useState("")
  const { messages, sendMessage, status, error, addToolApprovalResponse, stop } = useChat({
    id,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })
  const ocupado = status === "submitted" || status === "streaming"
  const esperandoConfirmacion = messages.some((m) =>
    m.parts.some((p) => isToolUIPart(p) && p.state === "approval-requested"),
  )

  const enviar = (texto: string) => {
    if (!texto.trim() || ocupado) return
    void sendMessage({ text: texto })
    setEntrada("")
  }
  const alEnviar = (e: FormEvent) => {
    e.preventDefault()
    enviar(entrada)
  }
  const responder = (approvalId: string, aprobado: boolean) => {
    void addToolApprovalResponse({ id: approvalId, approved: aprobado })
  }
  const reiniciar = async () => {
    if (!confirm("¿Volver el SharePoint simulado a su estado inicial? Se borran los registros de la demo.")) return
    await fetch("/api/reiniciar", { method: "POST" })
    nuevaConversacion()
  }

  return (
    <div className="contenedor">
      <header>
        <div>
          <h1>Registro de Contratos Vigentes</h1>
          <p>Agente de recepción de contratos · Reto 2 Periferia IT Group</p>
        </div>
        <div className="acciones">
          <button onClick={() => window.open("/api/archivos?nombre=maestro", "_blank")}>Ver maestro</button>
          <button onClick={() => window.open("/api/archivos?nombre=alertas", "_blank")}>Ver alertas</button>
          <button onClick={() => window.open("/api/archivos?nombre=historial", "_blank")}>Ver historial</button>
          <button onClick={nuevaConversacion}>Nueva conversación</button>
          <button className="peligro" onClick={reiniciar}>Reiniciar SharePoint</button>
        </div>
      </header>

      {esperandoConfirmacion ? <div className="banner">⚠ El agente espera tu confirmación: revisa la tarjeta amarilla y pulsa Confirmar o Rechazar.</div> : null}

      <div className="mensajes">
        {messages.length === 0 ? (
          <div className="burbuja">
            <p>Hola. Puedo leer el buzón, extraer los datos de cada contrato, detectar duplicados y actualizaciones, registrar en el maestro (siempre con tu confirmación) y generar alertas de vencimiento.</p>
            <button className="sugerencia" onClick={() => enviar(PROMPT_DEMO)}>▶ {PROMPT_DEMO}</button>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`burbuja ${m.role === "user" ? "usuario" : ""}`}>
            <div className="rol" style={m.role === "user" ? { color: "#e6f4ee" } : undefined}>{m.role === "user" ? "Tú" : "Agente"}</div>
            {m.parts.map((p, i) => {
              if (p.type === "text") return <Texto key={i} texto={p.text} />
              if (isToolUIPart(p)) return <Herramienta key={p.toolCallId} parte={p} responder={responder} />
              return null
            })}
          </div>
        ))}
        {ocupado ? <div className="pensando">El agente está pensando… <button onClick={() => void stop()}>Detener</button></div> : null}
        {error ? <div className="error">No se pudo completar: {error.message}. Puedes escribir de nuevo para continuar.</div> : null}
      </div>

      <form onSubmit={alEnviar}>
        <textarea
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              enviar(entrada)
            }
          }}
          placeholder={esperandoConfirmacion ? "Responde con los botones de la tarjeta amarilla…" : "Escribe un mensaje (Enter para enviar)"}
        />
        <button className="primario" type="submit" disabled={ocupado || !entrada.trim()}>Enviar</button>
      </form>
    </div>
  )
}

export default function Pagina() {
  const [id, setId] = useState(() => `sesion-${Date.now()}`)
  return <Chat key={id} id={id} nuevaConversacion={() => setId(`sesion-${Date.now()}`)} />
}

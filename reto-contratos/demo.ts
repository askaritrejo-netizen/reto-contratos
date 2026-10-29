/**
 * demo.ts — Verificación SIN modelo de lenguaje.
 * Procesa los 6 mensajes del buzón llamando directamente a las herramientas.
 * Ejecutar:  npm run demo   (o: bun run demo.ts)
 * No necesita ninguna clave. Limpia out/ al inicio para ser determinista.
 */
import { limpiarSalida, carpetaSalida } from "./src/lib/almacen"
import { leer_buzon, extraer, validar, registrar, alertas, type Contexto, type Validacion } from "./src/tools/contratos"
import type { Contrato } from "./src/lib/esquema"

const HOY = "2026-09-03"
const ctx: Contexto = { directory: process.cwd(), sessionId: "demo" }

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }
const parse = <T>(s: string): Respuesta<T> => JSON.parse(s) as Respuesta<T>

function linea(): void {
  console.log("-".repeat(78))
}

async function procesar(id: string, pendientes: Map<string, Contrato>): Promise<void> {
  linea()
  const ex = parse<Contrato>(await extraer.execute({ mensaje_id: id }, ctx))
  if (!ex.ok) {
    console.log(`${id} | ERROR de extracción: ${ex.error} → se continúa con el siguiente`)
    return
  }
  const c = ex.data
  const va = parse<Validacion>(await validar.execute({ mensaje_id: id, contrato: c }, ctx))
  if (!va.ok) {
    console.log(`${id} | ERROR de validación: ${va.error}`)
    return
  }
  const v = va.data
  console.log(`${id} | tipo: ${c.tipo_documento} | contrato: ${c.id_contrato ?? "-"} | cliente: ${c.cliente ?? "-"}`)
  console.log(`       comercial: ${c.comercial ?? "NO REGISTRADO (" + c.remitente + ")"}`)
  console.log(`       clasificación: ${v.clasificacion.toUpperCase()}`)
  console.log(`       en revisión: ${v.requiere_revision.length ? v.requiere_revision.join(", ") : "ninguno"}`)
  if (v.diferencias && Object.keys(v.diferencias).length) {
    for (const [k, d] of Object.entries(v.diferencias)) console.log(`       cambio ${k}: ${d.antes} → ${d.despues}`)
  }
  if (v.motivo) console.log(`       motivo: ${v.motivo}`)
  for (const a of v.advertencias) console.log(`       aviso: ${a}`)

  if (v.clasificacion === "nuevo" || v.clasificacion === "actualizacion") {
    const re = parse<{ id_contrato: string; accion: string; ruta_archivo: string }>(
      await registrar.execute({ mensaje_id: id, contrato: c, hoy: HOY }, ctx),
    )
    if (re.ok) console.log(`       ACCIÓN: ${re.data.accion} de ${re.data.id_contrato} · archivo: ${re.data.ruta_archivo}`)
    else {
      console.log(`       ACCIÓN: NO registrado → ${re.error}`)
      pendientes.set(id, c)
    }
  } else {
    console.log(`       ACCIÓN: ninguna escritura en el maestro`)
  }
}

async function main(): Promise<void> {
  limpiarSalida(ctx.directory)
  console.log(`DEMO sin modelo · fecha de referencia ${HOY} · salida en ${carpetaSalida(ctx.directory)}`)

  const buzon = parse<{ mensajes: Array<{ id: string; asunto: string; tiene_contrato: boolean }> }>(await leer_buzon.execute({}, ctx))
  if (!buzon.ok) throw new Error(buzon.error)
  console.log(`\nBuzón: ${buzon.data.mensajes.length} mensajes pendientes`)
  for (const m of buzon.data.mensajes) console.log(`  ${m.id} · contrato adjunto: ${m.tiene_contrato ? "sí" : "no"} · ${m.asunto}`)

  console.log("\n=== PRIMERA PASADA (sin confirmación humana) ===")
  const pendientes = new Map<string, Contrato>()
  for (const m of buzon.data.mensajes) await procesar(m.id, pendientes)

  linea()
  console.log("\n=== SEGUNDA PASADA: el humano confirma msg-006 (valor 0 y fecha fin 2027-08-31) ===")
  const c6 = pendientes.get("msg-006")
  if (c6) {
    const re = parse<{ id_contrato: string; accion: string; ruta_archivo: string }>(
      await registrar.execute({ mensaje_id: "msg-006", contrato: c6, confirmado: true, hoy: HOY }, ctx),
    )
    console.log(re.ok ? `msg-006 | ACCIÓN: ${re.data.accion} de ${re.data.id_contrato} · archivo: ${re.data.ruta_archivo}` : `msg-006 | ERROR: ${re.error}`)
  }

  console.log("\n=== Manejo de errores: argumentos inválidos no tumban el proceso ===")
  console.log(await extraer.execute({ mensaje_id: "msg-999" }, ctx))
  console.log(await alertas.execute({ hoy: "no-es-fecha" }, ctx))

  console.log("\n=== Reporte de alertas ===")
  const al = parse<{ vencen: Array<{ id_contrato: string; dias: number }>; polizas_pendientes: Array<{ id_contrato: string; estado_poliza: string }>; registrados_desde_corte: Array<{ id_contrato: string }> }>(
    await alertas.execute({ hoy: HOY }, ctx),
  )
  if (al.ok) {
    console.log(`Vencen en ≤ 60 días: ${al.data.vencen.map((v) => `${v.id_contrato} (${v.dias} días)`).join(", ") || "ninguno"}`)
    console.log(`Pólizas pendientes: ${al.data.polizas_pendientes.map((p) => `${p.id_contrato} (${p.estado_poliza})`).join(", ") || "ninguna"}`)
    console.log(`Registrados desde el corte: ${al.data.registrados_desde_corte.map((r) => r.id_contrato).join(", ") || "ninguno"}`)
    console.log("Reporte completo en out/alertas.md")
  }
  const restantes = parse<{ mensajes: unknown[] }>(await leer_buzon.execute({}, ctx))
  if (restantes.ok) console.log(`\nMensajes aún pendientes en el buzón: ${restantes.data.mensajes.length}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})

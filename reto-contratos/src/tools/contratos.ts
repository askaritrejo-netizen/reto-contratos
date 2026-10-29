/**
 * Herramientas del agente "Registro de Contratos Vigentes".
 * Cada export es un objeto { description, args (zod), execute(args, ctx) }.
 * El nombre que ve el modelo es contratos_<export>.
 * execute NUNCA lanza: devuelve un string JSON con { ok: true, data } o { ok: false, error }.
 * Toda la lógica es determinista (reglas), por eso demo.ts puede usarlas sin IA.
 */
import { z } from "zod"
import {
  CAMPOS_CONFIANZA, CAMPOS_OBLIGATORIOS_NUEVO, ComercialSchema, ContratoSchema, CorreoSchema, UMBRAL_CONFIANZA,
  type CampoConfianza, type Comercial, type Contrato, type Correo, type FilaMaestro, type Resultado,
} from "../lib/esquema"
import { leerArchivo, listarMensajes, RUTA_BUZON, RUTA_COMERCIALES } from "../lib/fuente"
import {
  escribirArchivo, guardarMaestro, leerMaestro, leerProcesados, marcarProcesado,
  registrarHistorial, registrarLog, REL_MAESTRO,
} from "../lib/almacen"
import { extraerDeTexto, normalizar, similitud, slug } from "../lib/extraccion"

export type Contexto = { directory: string; sessionId: string }

export const FECHA_CORTE = "2026-05-30"

// ======================================================================
// Utilidades comunes
// ======================================================================

function responder<T>(r: Resultado<T>): string {
  return JSON.stringify(r)
}

/** Valida los argumentos con zod y nunca deja escapar una excepción. */
async function ejecutarSeguro<S extends z.ZodRawShape, T>(
  nombre: string,
  forma: S,
  crudo: unknown,
  ctx: Contexto,
  fn: (args: z.infer<z.ZodObject<S>>) => Promise<Resultado<T>> | Resultado<T>,
): Promise<string> {
  const parsed = z.object(forma).safeParse(crudo ?? {})
  const mensajeId = typeof (crudo as { mensaje_id?: unknown })?.mensaje_id === "string"
    ? (crudo as { mensaje_id: string }).mensaje_id : null
  let r: Resultado<T>
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
    r = { ok: false, error: `Argumentos inválidos: ${detalle}` }
  } else {
    try {
      r = await fn(parsed.data)
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const resumen = r.ok ? resumir(r.data) : r.error
  try {
    registrarLog(ctx.directory, { herramienta: `contratos_${nombre}`, mensaje_id: mensajeId, ok: r.ok, resumen })
  } catch {
    // El log nunca debe tumbar la herramienta.
  }
  return responder(r)
}

function resumir(data: unknown): string {
  const texto = JSON.stringify(data)
  return texto.length > 300 ? texto.slice(0, 297) + "..." : texto
}

function leerCorreo(ctx: Contexto, mensajeId: string): Correo {
  const crudo = leerArchivo(ctx.directory, `${RUTA_BUZON}/${mensajeId}/correo.json`)
  if (crudo === null) throw new Error(`No existe el mensaje ${mensajeId} en el buzón`)
  return CorreoSchema.parse(JSON.parse(crudo))
}

function leerComerciales(ctx: Contexto): Comercial[] {
  const crudo = leerArchivo(ctx.directory, RUTA_COMERCIALES)
  return crudo ? z.array(ComercialSchema).parse(JSON.parse(crudo)) : []
}

/** Adjunto que contiene un contrato u otrosí (no cotizaciones ni otros). */
function adjuntoPrincipal(correo: Correo): string | null {
  const preferidos = correo.adjuntos.filter((a) => /contrato|otrosi|otros[ií]/i.test(a))
  return preferidos[0] ?? correo.adjuntos[0] ?? null
}

function esAdjuntoDeContrato(nombre: string): boolean {
  return /contrato|otros[ií]/i.test(normalizar(nombre))
}

// ======================================================================
// 1. contratos_leer_buzon
// ======================================================================

const argsLeerBuzon = {}

export const leer_buzon = {
  description: "Lista los mensajes del buzón de contratos que aún no se han procesado, con remitente, asunto, fecha y adjuntos.",
  args: argsLeerBuzon,
  async execute(args: unknown, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("leer_buzon", argsLeerBuzon, args, ctx, () => {
      const procesados = leerProcesados(ctx.directory)
      const mensajes = listarMensajes(ctx.directory)
        .filter((id) => !procesados[id])
        .map((id) => {
          const c = leerCorreo(ctx, id)
          return {
            id: c.id, de: c.de, asunto: c.asunto, fecha: c.fecha, adjuntos: c.adjuntos,
            tiene_contrato: c.adjuntos.some(esAdjuntoDeContrato),
          }
        })
      return { ok: true, data: { mensajes, ya_procesados: Object.keys(procesados) } }
    })
  },
}

// ======================================================================
// 2. contratos_extraer
// ======================================================================

const argsExtraer = {
  mensaje_id: z.string().describe("Id del mensaje del buzón, por ejemplo msg-001"),
}

export const extraer = {
  description: "Lee el adjunto de un mensaje y extrae con reglas fijas los datos del contrato, con confianza por campo (0 a 1).",
  args: argsExtraer,
  async execute(args: unknown, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("extraer", argsExtraer, args, ctx, ({ mensaje_id }) => extraerContrato(ctx, mensaje_id))
  },
}

export function extraerContrato(ctx: Contexto, mensajeId: string): Resultado<Contrato> {
  const correo = leerCorreo(ctx, mensajeId)
  const comercial = leerComerciales(ctx).find((c) => c.email.toLowerCase() === correo.de.toLowerCase())
  const avisoRemitente = comercial ? [] : [`Remitente no registrado en comerciales.json: ${correo.de}`]
  const archivo = adjuntoPrincipal(correo)
  const base = { comercial: comercial?.nombre ?? null, remitente: correo.de, archivo }
  if (!archivo) {
    return { ok: true, data: sinDocumento(base, ["El correo no trae adjuntos", ...avisoRemitente]) }
  }
  const texto = leerArchivo(ctx.directory, `${RUTA_BUZON}/${mensajeId}/${archivo}`)
  if (texto === null) return { ok: false, error: `No se pudo leer el adjunto ${archivo}` }
  const r = extraerDeTexto(texto, archivo, correo.fecha)
  if (!r.ok) return r
  const contrato: Contrato = { ...r.contrato, ...base, observaciones: [...r.contrato.observaciones, ...avisoRemitente] }
  return { ok: true, data: contrato }
}

function sinDocumento(base: Pick<Contrato, "comercial" | "remitente" | "archivo">, notas: string[]): Contrato {
  return {
    tipo_documento: "otro", id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null,
    valor: null, valor_indeterminado: false, moneda: null, fecha_inicio: null, fecha_fin: null,
    requiere_poliza: null, tipo_poliza: "", estado_poliza: null, ...base, observaciones: notas, confianza: {},
  }
}

// ======================================================================
// 3. contratos_validar
// ======================================================================

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"
export type Diferencia = { antes: string; despues: string }
export type Validacion = {
  clasificacion: Clasificacion
  id_contrato_existente?: string
  requiere_revision: string[]
  diferencias?: Record<string, Diferencia>
  motivo?: string
  advertencias: string[]
}

const argsValidar = {
  mensaje_id: z.string().describe("Id del mensaje del buzón"),
  contrato: ContratoSchema.describe("Contrato tal como lo devolvió contratos_extraer"),
}

export const validar = {
  description: "Clasifica un contrato extraído como nuevo, actualizacion, duplicado o rechazado (reglas RN1-RN5) y lista los campos que requieren revisión humana.",
  args: argsValidar,
  async execute(args: unknown, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("validar", argsValidar, args, ctx, ({ mensaje_id, contrato }) => {
      const v = clasificar(ctx, contrato)
      // Duplicados y rechazados no escriben en el maestro: se cierran aquí y se reportan.
      if (v.clasificacion === "duplicado" || v.clasificacion === "rechazado") {
        marcarProcesado(ctx.directory, mensaje_id, v.clasificacion, v.motivo ?? "")
      }
      return { ok: true, data: v }
    })
  },
}

const valorEnFila = (fila: FilaMaestro, campo: CampoConfianza): string => fila[campo]

function valorDeContrato(c: Contrato, campo: CampoConfianza): string | null {
  const v = c[campo]
  if (v === null || v === undefined) return null
  if (campo === "tipo_poliza" && v === "" && c.tipo_documento === "otrosi") return null
  return String(v)
}

function camposBajaConfianza(c: Contrato): string[] {
  const conf = (campo: string) => c.confianza[campo] ?? 0
  if (c.tipo_documento === "otrosi") {
    // En un otrosí solo cuentan los campos que el documento modifica.
    return CAMPOS_CONFIANZA.filter((k) => valorDeContrato(c, k) !== null && conf(k) < UMBRAL_CONFIANZA)
  }
  return CAMPOS_OBLIGATORIOS_NUEVO.filter((k) => c[k] === null || conf(k) < UMBRAL_CONFIANZA)
}

function diferenciasCon(fila: FilaMaestro, c: Contrato): Record<string, Diferencia> {
  const difs: Record<string, Diferencia> = {}
  for (const campo of CAMPOS_CONFIANZA) {
    if (campo === "id_contrato") continue
    const nuevo = valorDeContrato(c, campo)
    if (nuevo === null) continue
    const antes = valorEnFila(fila, campo)
    const iguales = campo === "valor" ? Number(antes) === Number(nuevo) : normalizar(antes) === normalizar(nuevo)
    if (!iguales) difs[campo] = { antes, despues: nuevo }
  }
  return difs
}

function buscarExistente(maestro: FilaMaestro[], c: Contrato): FilaMaestro | undefined {
  if (c.id_contrato) {
    const porId = maestro.find((f) => f.id_contrato === c.id_contrato)
    if (porId) return porId
  }
  if (c.nit_cliente && c.objeto) {
    return maestro.find((f) => f.nit_cliente === c.nit_cliente && similitud(f.objeto, c.objeto ?? "") >= 0.9)
  }
  return undefined
}

export function clasificar(ctx: Contexto, c: Contrato): Validacion {
  const advertencias = c.observaciones.filter((o) => /remitente no registrado/i.test(o))
  if (c.tipo_documento === "cotizacion" || c.tipo_documento === "otro") {
    const motivo = c.tipo_documento === "cotizacion"
      ? "El adjunto es una cotización, no un contrato firmado (RN4)"
      : "El mensaje no trae un contrato identificable (RN4)"
    return { clasificacion: "rechazado", requiere_revision: [], motivo, advertencias }
  }
  if (c.tipo_documento === "contrato" && !c.cliente && !c.objeto) {
    return { clasificacion: "rechazado", requiere_revision: [], motivo: "El texto no tiene partes ni objeto identificables (RN4)", advertencias }
  }
  const revision = camposBajaConfianza(c)
  const existente = buscarExistente(leerMaestro(ctx.directory), c)

  if (c.tipo_documento === "otrosi") {
    if (!existente) {
      return { clasificacion: "rechazado", requiere_revision: [], motivo: `Otrosí de un contrato que no está en el maestro (${c.id_contrato ?? "sin número"})`, advertencias }
    }
    return { clasificacion: "actualizacion", id_contrato_existente: existente.id_contrato, requiere_revision: revision, diferencias: diferenciasCon(existente, c), advertencias }
  }
  if (!existente) return { clasificacion: "nuevo", requiere_revision: revision, advertencias }

  const mismoValor = Number(existente.valor) === Number(c.valor ?? NaN)
  const mismasFechas = existente.fecha_inicio === c.fecha_inicio && existente.fecha_fin === c.fecha_fin
  if (existente.id_contrato === c.id_contrato && mismoValor && mismasFechas) {
    return {
      clasificacion: "duplicado", id_contrato_existente: existente.id_contrato, requiere_revision: [],
      motivo: `Mismo número, valor y fechas que ${existente.id_contrato} ya registrado el ${existente.fecha_registro} (RN1). No se escribe nada.`,
      advertencias,
    }
  }
  const conflictos = existente.nit_cliente && c.nit_cliente && existente.nit_cliente !== c.nit_cliente ? ["conflicto:nit_cliente"] : []
  return {
    clasificacion: "actualizacion", id_contrato_existente: existente.id_contrato,
    requiere_revision: [...revision, ...conflictos], diferencias: diferenciasCon(existente, c), advertencias,
  }
}

// ======================================================================
// 4. contratos_registrar
// ======================================================================

const argsRegistrar = {
  mensaje_id: z.string().describe("Id del mensaje del buzón"),
  contrato: ContratoSchema.describe("Contrato a registrar (el que devolvió contratos_extraer, con las correcciones que confirmó el humano)"),
  confirmado: z.boolean().optional().describe("true solo si el humano confirmó explícitamente los campos en revisión"),
  hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de registro YYYY-MM-DD; por defecto la fecha actual"),
}

export type Registro = { id_contrato: string; accion: "alta" | "actualizacion"; ruta_archivo: string; cambios?: Record<string, Diferencia> }

export const registrar = {
  description: "Escribe o actualiza el contrato en el maestro de SharePoint, archiva el documento y deja historial. Requiere confirmación humana.",
  args: argsRegistrar,
  async execute(args: unknown, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("registrar", argsRegistrar, args, ctx, (a) =>
      registrarContrato(ctx, a.mensaje_id, a.contrato, a.confirmado === true, a.hoy ?? new Date().toISOString().slice(0, 10)))
  },
}

function registrarContrato(ctx: Contexto, mensajeId: string, c: Contrato, confirmado: boolean, hoy: string): Resultado<Registro> {
  const v = clasificar(ctx, c)
  if (v.clasificacion === "rechazado") return { ok: false, error: `No se registra: ${v.motivo}` }
  if (v.clasificacion === "duplicado") return { ok: false, error: `No se registra: ${v.motivo}` }
  if (v.requiere_revision.length > 0 && !confirmado) {
    return { ok: false, error: `requiere revisión: ${v.requiere_revision.join(", ")}. Pide confirmación al usuario y vuelve a llamar con confirmado = true.` }
  }
  const maestro = leerMaestro(ctx.directory)
  const r = v.clasificacion === "nuevo"
    ? altaContrato(ctx, maestro, mensajeId, c, hoy)
    : actualizarContrato(ctx, maestro, mensajeId, c, v.id_contrato_existente ?? "", hoy)
  marcarProcesado(ctx.directory, mensajeId, r.accion, r.id_contrato)
  return { ok: true, data: r }
}

function archivar(ctx: Contexto, mensajeId: string, c: Contrato, anio: string, cliente: string, nombre: string): string {
  const original = c.archivo ? leerArchivo(ctx.directory, `${RUTA_BUZON}/${mensajeId}/${c.archivo}`) : null
  const ext = c.archivo?.split(".").pop() ?? "txt"
  const ruta = `Contratos/${anio}/${slug(cliente)}/${nombre}.${ext}`
  escribirArchivo(ctx.directory, `sharepoint/${ruta}`, original ?? "")
  return ruta
}

function siguienteAuto(maestro: FilaMaestro[], anio: string): string {
  const n = maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length + 1
  return `AUTO-${anio}-${String(n).padStart(3, "0")}`
}

function altaContrato(ctx: Contexto, maestro: FilaMaestro[], mensajeId: string, c: Contrato, hoy: string): Registro {
  const anio = (c.fecha_inicio ?? hoy).slice(0, 4)
  const id = c.id_contrato ?? siguienteAuto(maestro, anio)
  const cliente = c.cliente ?? "sin-cliente"
  const ruta = archivar(ctx, mensajeId, c, anio, cliente, id)
  const fila: FilaMaestro = {
    id_contrato: id, cliente, nit_cliente: c.nit_cliente ?? "", pais: c.pais ?? "", objeto: c.objeto ?? "",
    valor: String(c.valor ?? 0), moneda: c.moneda ?? "", fecha_inicio: c.fecha_inicio ?? "", fecha_fin: c.fecha_fin ?? "",
    requiere_poliza: String(c.requiere_poliza === true), tipo_poliza: c.requiere_poliza ? c.tipo_poliza : "",
    estado_poliza: c.requiere_poliza ? "pendiente" : "no_aplica",
    comercial: c.comercial ?? `No registrado (${c.remitente})`, ruta_sharepoint: ruta, fecha_registro: hoy, fuente: "buzon",
  }
  guardarMaestro(ctx.directory, [...maestro, fila])
  registrarHistorial(ctx.directory, { id_contrato: id, accion: "alta", cambios: fila, mensaje_id: mensajeId })
  return { id_contrato: id, accion: "alta", ruta_archivo: `sharepoint/${ruta}` }
}

function actualizarContrato(ctx: Contexto, maestro: FilaMaestro[], mensajeId: string, c: Contrato, id: string, hoy: string): Registro {
  const fila = maestro.find((f) => f.id_contrato === id)
  if (!fila) throw new Error(`El contrato ${id} ya no está en el maestro`)
  const cambios = diferenciasCon(fila, c)
  const actualizada: FilaMaestro = { ...fila }
  for (const [campo, d] of Object.entries(cambios)) actualizada[campo as CampoConfianza] = d.despues
  const nombre = c.tipo_documento === "otrosi" ? `${id}_otrosi_${mensajeId}` : `${id}_${mensajeId}`
  const ruta = archivar(ctx, mensajeId, c, fila.fecha_inicio.slice(0, 4) || hoy.slice(0, 4), fila.cliente, nombre)
  guardarMaestro(ctx.directory, maestro.map((f) => (f.id_contrato === id ? actualizada : f)))
  registrarHistorial(ctx.directory, { id_contrato: id, accion: "actualizacion", cambios, mensaje_id: mensajeId })
  return { id_contrato: id, accion: "actualizacion", ruta_archivo: `sharepoint/${ruta}`, cambios }
}

// ======================================================================
// 5. contratos_alertas
// ======================================================================

const argsAlertas = {
  hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha de referencia YYYY-MM-DD para calcular vencimientos"),
}

type FilaAlerta = { id_contrato: string; cliente: string; fecha_fin: string; dias: number; comercial: string }
type PolizaPendiente = { id_contrato: string; cliente: string; tipo_poliza: string; estado_poliza: string; comercial: string }
type Alertas = {
  ruta: string
  hoy: string
  vencen: FilaAlerta[]
  vencidos: FilaAlerta[]
  polizas_pendientes: PolizaPendiente[]
  registrados_desde_corte: Array<{ id_contrato: string; cliente: string; fecha_registro: string }>
  total_contratos: number
}

export const alertas = {
  description: "Genera el reporte de riesgos (vencen en 60 días o menos, pólizas pendientes y contratos registrados desde el corte del 2026-05-30) y lo guarda en alertas.md.",
  args: argsAlertas,
  async execute(args: unknown, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("alertas", argsAlertas, args, ctx, ({ hoy }) => generarAlertas(ctx, hoy))
  },
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000)
}

function generarAlertas(ctx: Contexto, hoy: string): Resultado<Alertas> {
  if (Number.isNaN(Date.parse(hoy))) return { ok: false, error: `Fecha inválida: ${hoy}` }
  const maestro = leerMaestro(ctx.directory)
  const conDias = maestro
    .filter((f) => f.fecha_fin)
    .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias: diasEntre(hoy, f.fecha_fin), comercial: f.comercial }))
  const data: Alertas = {
    ruta: "alertas.md",
    hoy,
    vencen: conDias.filter((f) => f.dias >= 0 && f.dias <= 60).sort((a, b) => a.dias - b.dias),
    vencidos: conDias.filter((f) => f.dias < 0).sort((a, b) => a.dias - b.dias),
    polizas_pendientes: maestro
      .filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente")
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, tipo_poliza: f.tipo_poliza, estado_poliza: f.estado_poliza, comercial: f.comercial })),
    registrados_desde_corte: maestro
      .filter((f) => f.fecha_registro > FECHA_CORTE)
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro })),
    total_contratos: maestro.length,
  }
  escribirArchivo(ctx.directory, "alertas.md", alertasMarkdown(data))
  return { ok: true, data }
}

function alertasMarkdown(a: Alertas): string {
  const tabla = (encabezado: string, filas: string[]) =>
    filas.length ? [encabezado, encabezado.replace(/[^|]/g, "-"), ...filas].join("\n") : "_Sin registros._"
  return [
    `# Alertas de contratos — referencia ${a.hoy}`,
    "",
    `Maestro: \`${REL_MAESTRO}\` · ${a.total_contratos} contratos · corte del registro congelado: ${FECHA_CORTE}`,
    "",
    "## 1. Contratos que vencen en 60 días o menos",
    tabla("| Contrato | Cliente | Fecha fin | Días | Comercial |", a.vencen.map((f) => `| ${f.id_contrato} | ${f.cliente} | ${f.fecha_fin} | ${f.dias} | ${f.comercial} |`)),
    "",
    "### Ya vencidos (sin renovación registrada)",
    tabla("| Contrato | Cliente | Fecha fin | Días vencido | Comercial |", a.vencidos.map((f) => `| ${f.id_contrato} | ${f.cliente} | ${f.fecha_fin} | ${-f.dias} | ${f.comercial} |`)),
    "",
    "## 2. Pólizas exigidas que no están vigentes",
    tabla("| Contrato | Cliente | Tipo de póliza | Estado | Comercial |", a.polizas_pendientes.map((f) => `| ${f.id_contrato} | ${f.cliente} | ${f.tipo_poliza} | ${f.estado_poliza} | ${f.comercial} |`)),
    "",
    `## 3. Contratos registrados desde el corte (${FECHA_CORTE}) — gap cubierto`,
    tabla("| Contrato | Cliente | Fecha de registro |", a.registrados_desde_corte.map((f) => `| ${f.id_contrato} | ${f.cliente} | ${f.fecha_registro} |`)),
    "",
  ].join("\n")
}

/** Todas las herramientas, con el nombre que ve el modelo. */
export const HERRAMIENTAS = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
} as const

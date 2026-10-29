/**
 * Extracción DETERMINISTA (reglas y expresiones regulares, sin IA) de los
 * datos de un contrato u otrosí a partir de su texto.
 * Cada campo devuelve un valor y una confianza entre 0 y 1.
 * Campo que no aparece en el texto => null con confianza 0 (nunca inventado).
 */
import type { Contrato, EstadoPoliza, Moneda, Pais, TipoDocumento } from "./esquema"
import { MONEDAS } from "./esquema"

type Campo<T> = { valor: T; confianza: number }
const ausente = <T>(): Campo<T | null> => ({ valor: null, confianza: 0 })

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const PERIFERIA_NIT = "900123456"

// ---------- utilidades de texto ----------

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

function parrafos(texto: string): string[] {
  return texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

/** Primer párrafo que contiene la palabra en MAYÚSCULAS (encabezado de cláusula). */
function clausula(texto: string, patron: RegExp): string | null {
  return parrafos(texto).find((p) => patron.test(p)) ?? null
}

// ---------- fechas ----------

function iso(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return f.toISOString().slice(0, 10)
}

/** Encuentra fechas escritas como "quince (15) de agosto de 2026" o "15 de agosto de 2026". */
export function fechasEnTexto(texto: string): string[] {
  const t = normalizar(texto)
  const re = /(?:\((\d{1,2})\)|\b(\d{1,2}))\s+(?:dias\s+del\s+mes\s+)?de\s+([a-z]+)\s+de\s+(\d{4})/g
  const fechas: string[] = []
  for (const m of t.matchAll(re)) {
    const mes = MESES[m[3]]
    const f = mes ? iso(Number(m[4]), mes, Number(m[1] ?? m[2])) : null
    if (f) fechas.push(f)
  }
  return fechas
}

function sumarMeses(fecha: string, meses: number): Date {
  const [a, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1 + meses, d))
}

function aIso(f: Date): string {
  return f.toISOString().slice(0, 10)
}

function finDeMes(f: Date): string {
  return aIso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)))
}

/** Fecha de firma: "a los treinta (30) días del mes de julio de 2026" o solo "en el mes de agosto de 2026". */
function fechaFirma(texto: string, fechaCorreo: string): { fecha: string | null; confianza: number; diaIncierto: boolean } {
  const completa = /a los .*?d[ií]as del mes de [a-z]+ de \d{4}/i.exec(texto)
  if (completa) {
    const f = fechasEnTexto(completa[0])[0]
    if (f) return { fecha: f, confianza: 0.95, diaIncierto: false }
  }
  const parcial = /en el mes de ([a-z]+) de (\d{4})/.exec(normalizar(texto))
  if (!parcial) return { fecha: null, confianza: 0, diaIncierto: true }
  const anio = Number(parcial[2])
  const mes = MESES[parcial[1]]
  if (!mes) return { fecha: null, confianza: 0, diaIncierto: true }
  const correo = fechaCorreo.slice(0, 10)
  const mismoMes = correo.startsWith(`${anio}-${String(mes).padStart(2, "0")}`)
  // Supuesto documentado: si el correo llegó ese mismo mes, el día de firma es a más tardar el del correo.
  if (mismoMes) return { fecha: correo, confianza: 0.8, diaIncierto: true }
  return { fecha: iso(anio, mes, 1), confianza: 0.5, diaIncierto: true }
}

// ---------- números y dinero ----------

export function parsearNumero(crudo: string): number {
  let s = crudo.replace(/[.,]$/, "")
  const punto = s.lastIndexOf(".")
  const coma = s.lastIndexOf(",")
  if (punto >= 0 && coma >= 0) {
    const decimal = punto > coma ? "." : ","
    const miles = decimal === "." ? "," : "."
    s = s.split(miles).join("").replace(decimal, ".")
  } else if (punto >= 0 || coma >= 0) {
    const sep = punto >= 0 ? "." : ","
    const partes = s.split(sep)
    const sonMiles = partes.slice(1).every((p) => p.length === 3)
    s = sonMiles ? partes.join("") : partes.join(".")
  }
  return Number(s)
}

type Dinero = { valor: Campo<number | null>; moneda: Campo<Moneda | null>; indeterminado: boolean; error?: string }

function extraerDinero(texto: string, pais: Pais | null): Dinero {
  const parrafo = clausula(texto, /\bVALOR\b/)
  if (!parrafo) return { valor: ausente(), moneda: ausente(), indeterminado: false }
  const sinValor = /no tiene (un )?valor determinado|valor indeterminado|por demanda/i.test(parrafo)
  if (sinValor) {
    const enTexto = /\b(COP|USD|PEN|PAB|HNL)\b/.exec(texto)
    const moneda = enTexto ? { valor: enTexto[1] as Moneda, confianza: 0.8 } : monedaPorPais(pais)
    return { valor: { valor: 0, confianza: 0.5 }, moneda, indeterminado: true }
  }
  const m = /\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*(\d[\d.,]*)/.exec(parrafo)
  if (m) {
    const numero = parsearNumero(m[2])
    if (Number.isFinite(numero)) {
      return { valor: { valor: numero, confianza: 0.95 }, moneda: { valor: m[1] as Moneda, confianza: 0.95 }, indeterminado: false }
    }
  }
  const otra = /\b([A-Z]{3})\s*\$?\s*\d/.exec(parrafo)
  if (otra && !(MONEDAS as readonly string[]).includes(otra[1])) {
    return { valor: ausente(), moneda: ausente(), indeterminado: false, error: `Moneda desconocida: ${otra[1]}` }
  }
  return { valor: ausente(), moneda: ausente(), indeterminado: false }
}

function monedaPorPais(pais: Pais | null): Campo<Moneda | null> {
  const mapa: Record<Pais, Moneda> = { CO: "COP", EC: "USD", PE: "PEN", PA: "USD", HN: "HNL" }
  return pais ? { valor: mapa[pais], confianza: 0.6 } : ausente()
}

// ---------- partes ----------

function nombreDesdeEncabezado(texto: string): string | null {
  const m = /Entre\s+(?:los suscritos,\s*)?(.+?),\s*(?:identificad[ao]\s+con|NIT|RUC|RTN)/s.exec(texto)
  return m ? m[1].replace(/\s+/g, " ").trim() : null
}

function capitalizar(nombre: string): string {
  const menores = new Set(["de", "del", "la", "las", "los", "y", "e"])
  return nombre
    .toLowerCase()
    .split(" ")
    .map((p, i) => (i > 0 && menores.has(p) ? p : p.replace(/^\p{L}/u, (c) => c.toUpperCase())))
    .join(" ")
    .replace(/\bS\.a\.s\./gi, "S.A.S.").replace(/\bS\.a\.c\./gi, "S.A.C.").replace(/\bS\.a\./gi, "S.A.")
}

/** El bloque de firmas trae la razón social bien escrita; se usa si coincide con el encabezado. */
function extraerCliente(texto: string): Campo<string | null> {
  const encabezado = nombreDesdeEncabezado(texto)
  if (!encabezado) return ausente()
  const buscado = normalizar(encabezado)
  const segmentos = texto.split("\n").flatMap((l) => l.split(/\s{2,}/)).map((s) => s.trim())
  const firma = segmentos.find((s) => normalizar(s) === buscado && s !== encabezado)
  return firma ? { valor: firma, confianza: 0.95 } : { valor: capitalizar(encabezado), confianza: 0.85 }
}

type Identificacion = { tipo: string; numero: string }

function extraerIdentificacion(texto: string): Identificacion | null {
  for (const m of texto.matchAll(/\b(NIT|RUC|RTN)\s*(?:No\.?\s*)?(\d[\d.]*)(?:-\d)?/g)) {
    const numero = m[2].replace(/\./g, "")
    if (numero !== PERIFERIA_NIT) return { tipo: m[1], numero }
  }
  return null
}

const CIUDADES: Array<[RegExp, Pais]> = [
  [/ecuador|quito|guayaquil/, "EC"],
  [/peru|lima|arequipa/, "PE"],
  [/panama/, "PA"],
  [/honduras|tegucigalpa|san pedro sula/, "HN"],
  [/colombia|bogota|medellin|barranquilla|cali|cartagena|bucaramanga/, "CO"],
]

function paisPorIdentificacion(id: Identificacion | null): Pais | null {
  if (!id) return null
  if (id.tipo === "RTN" || id.numero.length === 14) return "HN"
  if (id.tipo === "RUC" && id.numero.length === 13) return "EC"
  if (id.tipo === "RUC" && id.numero.length === 11) return "PE"
  if (id.tipo === "NIT") return "CO"
  return null
}

function paisPorDomicilio(texto: string): Pais | null {
  const m = /domicilio en ([^,]+(?:,\s*[^,]+)?)/.exec(normalizar(texto))
  const lugar = m ? m[1] : normalizar(texto.split("\n").slice(-6).join(" "))
  return CIUDADES.find(([re]) => re.test(lugar))?.[1] ?? null
}

function extraerPais(texto: string, id: Identificacion | null): Campo<Pais | null> {
  const porId = paisPorIdentificacion(id)
  const porLugar = paisPorDomicilio(texto)
  if (porId && porLugar) return porId === porLugar ? { valor: porId, confianza: 0.95 } : { valor: porLugar, confianza: 0.6 }
  const uno = porId ?? porLugar
  return uno ? { valor: uno, confianza: 0.85 } : ausente()
}

function extraerObjeto(texto: string): Campo<string | null> {
  const p = clausula(texto, /\bOBJETO\b/)
  if (!p) return ausente()
  let objeto = p.replace(/^.*?OBJETO\.\s*/s, "").replace(/\s+/g, " ").trim()
  objeto = objeto.replace(/^EL CONTRATISTA\s+(se obliga a|se compromete a|prestar[aá])\s+/i, "")
  objeto = objeto.replace(/\.$/, "")
  objeto = objeto.charAt(0).toUpperCase() + objeto.slice(1)
  if (objeto.length > 200) objeto = objeto.slice(0, 197).replace(/\s+\S*$/, "") + "..."
  return { valor: objeto, confianza: 0.9 }
}

function extraerIdContrato(texto: string): Campo<string | null> {
  const m = /CONTRATO[^\n]*?No\.\s*([A-Z]{1,5}-\d{4}-\d{1,5})/.exec(texto)
  return m ? { valor: m[1], confianza: 0.95 } : ausente()
}

// ---------- plazo ----------

type Plazo = { inicio: Campo<string | null>; fin: Campo<string | null>; notas: string[] }

function extraerPlazo(texto: string, tipo: TipoDocumento, fechaCorreo: string): Plazo {
  const p = clausula(texto, /\bPLAZO\b/)
  const notas: string[] = []
  if (!p) return { inicio: ausente(), fin: ausente(), notas }
  const fechas = fechasEnTexto(p)
  const t = normalizar(p)
  if (tipo === "otrosi") {
    const fin = /hasta/.test(t) && fechas.length > 0 ? { valor: fechas[fechas.length - 1], confianza: 0.95 } : ausente<string>()
    return { inicio: ausente(), fin, notas }
  }
  if (/desde/.test(t) && /hasta/.test(t) && fechas.length >= 2) {
    return { inicio: { valor: fechas[0], confianza: 0.95 }, fin: { valor: fechas[1], confianza: 0.95 }, notas }
  }
  const meses = /\((\d{1,3})\)\s+meses/.exec(p)
  if (meses && fechas.length === 1) {
    const fin = aIso(new Date(sumarMeses(fechas[0], Number(meses[1])).getTime() - 86400000))
    notas.push(`fecha_fin derivada de un plazo de ${meses[1]} meses`)
    return { inicio: { valor: fechas[0], confianza: 0.95 }, fin: { valor: fin, confianza: 0.85 }, notas }
  }
  if (meses && /firma/.test(t)) return plazoDesdeFirma(texto, Number(meses[1]), fechaCorreo, t, notas)
  return { inicio: ausente(), fin: ausente(), notas }
}

function plazoDesdeFirma(texto: string, meses: number, fechaCorreo: string, t: string, notas: string[]): Plazo {
  const firma = fechaFirma(texto, fechaCorreo)
  if (!firma.fecha) return { inicio: ausente(), fin: ausente(), notas }
  const limite = new Date(sumarMeses(firma.fecha, meses).getTime() - 86400000)
  // Con día de firma incierto se toma el cierre del mes (supuesto conservador, requiere confirmación).
  const fin = firma.diaIncierto ? finDeMes(limite) : aIso(limite)
  notas.push(`Plazo de ${meses} meses contados desde la firma; fecha_fin calculada, no escrita en el contrato`)
  if (firma.diaIncierto) notas.push("El contrato no indica el día de firma; se tomó la fecha del correo como inicio")
  if (/prorrog/.test(t)) notas.push("Prórroga automática por periodos iguales: revisar antes del vencimiento")
  return { inicio: { valor: firma.fecha, confianza: firma.confianza }, fin: { valor: fin, confianza: 0.6 }, notas }
}

// ---------- póliza ----------

const TIPOS_POLIZA: Array<[RegExp, string]> = [
  [/cumplimiento/, "cumplimiento"],
  [/calidad/, "calidad"],
  [/responsabilidad civil/, "responsabilidad_civil"],
  [/salarios|prestaciones sociales/, "salarios_prestaciones"],
  [/anticipo/, "buen_manejo_anticipo"],
  [/estabilidad/, "estabilidad"],
]

type Poliza = { requiere: Campo<boolean | null>; tipo: Campo<string>; estado: Campo<EstadoPoliza | null>; notas: string[] }

function extraerPoliza(texto: string, tipo: TipoDocumento): Poliza {
  const p = clausula(texto, /GARANT[IÍ]AS|p[oó]liza/i)
  const t = p ? normalizar(p) : ""
  if (tipo === "otrosi") {
    if (/garantia/.test(t) && /ampliar/.test(t)) {
      return {
        requiere: ausente(), tipo: { valor: "", confianza: 0 },
        estado: { valor: "pendiente", confianza: 0.85 },
        notas: ["El otrosí exige ampliar la vigencia de las pólizas: queda pendiente de renovación"],
      }
    }
    return { requiere: ausente(), tipo: { valor: "", confianza: 0 }, estado: ausente(), notas: [] }
  }
  if (!p || !/poliza/.test(t)) {
    return { requiere: { valor: false, confianza: 0.9 }, tipo: { valor: "", confianza: 0.9 }, estado: { valor: "no_aplica", confianza: 0.9 }, notas: [] }
  }
  if (/para cada orden|cuyo valor supere|en caso de que/.test(t)) {
    return {
      requiere: { valor: false, confianza: 0.8 }, tipo: { valor: "", confianza: 0.8 },
      estado: { valor: "no_aplica", confianza: 0.8 },
      notas: ["Póliza condicional: se exige solo para órdenes de servicio que superen el umbral del contrato"],
    }
  }
  const tipos = TIPOS_POLIZA.filter(([re]) => re.test(t)).map(([, n]) => n)
  return {
    requiere: { valor: true, confianza: 0.95 },
    tipo: { valor: tipos.join(";"), confianza: tipos.length ? 0.9 : 0.5 },
    estado: { valor: "pendiente", confianza: 0.95 },
    notas: [],
  }
}

// ---------- tipo de documento ----------

export function tipoDocumento(nombreArchivo: string, texto: string): TipoDocumento {
  const inicio = normalizar(texto.slice(0, 200))
  if (/^otrosi/.test(inicio) || /otrosi/.test(normalizar(nombreArchivo))) return "otrosi"
  if (/^cotizacion|^propuesta|^oferta/.test(inicio)) return "cotizacion"
  if (/^contrato/.test(inicio)) return "contrato"
  return "otro"
}

// ---------- extracción completa ----------

export type Extraccion = { ok: true; contrato: Omit<Contrato, "comercial" | "remitente" | "archivo"> } | { ok: false; error: string }

export function extraerDeTexto(texto: string, nombreArchivo: string, fechaCorreo: string): Extraccion {
  if (texto.trim().length < 20) return { ok: false, error: "El documento está vacío o no tiene texto legible" }
  const tipo = tipoDocumento(nombreArchivo, texto)
  if (tipo === "cotizacion" || tipo === "otro") return { ok: true, contrato: vacio(tipo) }

  const id = extraerIdContrato(texto)
  const cliente = extraerCliente(texto)
  const ident = extraerIdentificacion(texto)
  const nit: Campo<string | null> = ident ? { valor: ident.numero, confianza: 0.95 } : ausente()
  const pais = extraerPais(texto, ident)
  const objeto = tipo === "otrosi" ? ausente<string>() : extraerObjeto(texto)
  const dinero = extraerDinero(texto, pais.valor)
  if (dinero.error) return { ok: false, error: dinero.error }
  const plazo = extraerPlazo(texto, tipo, fechaCorreo)
  if (tipo === "otrosi" && !plazo.inicio.valor) {
    const suscrito = /suscrito el ([^,]+)/i.exec(texto)
    if (suscrito) plazo.notas.push(`Contrato original suscrito el ${suscrito[1].trim()}`)
  }
  const poliza = extraerPoliza(texto, tipo)

  return {
    ok: true,
    contrato: {
      tipo_documento: tipo,
      id_contrato: id.valor,
      cliente: cliente.valor,
      nit_cliente: nit.valor,
      pais: pais.valor,
      objeto: objeto.valor,
      valor: dinero.valor.valor,
      valor_indeterminado: dinero.indeterminado,
      moneda: dinero.moneda.valor,
      fecha_inicio: plazo.inicio.valor,
      fecha_fin: plazo.fin.valor,
      requiere_poliza: poliza.requiere.valor,
      tipo_poliza: poliza.tipo.valor,
      estado_poliza: poliza.estado.valor,
      observaciones: [...plazo.notas, ...poliza.notas, ...(dinero.indeterminado ? ["Contrato sin valor determinado (por demanda): se registra con valor 0"] : [])],
      confianza: {
        id_contrato: id.confianza, cliente: cliente.confianza, nit_cliente: nit.confianza,
        pais: pais.confianza, objeto: objeto.confianza, valor: dinero.valor.confianza,
        moneda: dinero.moneda.confianza, fecha_inicio: plazo.inicio.confianza, fecha_fin: plazo.fin.confianza,
        requiere_poliza: poliza.requiere.confianza, tipo_poliza: poliza.tipo.confianza, estado_poliza: poliza.estado.confianza,
      },
    },
  }
}

function vacio(tipo: TipoDocumento): Omit<Contrato, "comercial" | "remitente" | "archivo"> {
  return {
    tipo_documento: tipo, id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null,
    valor: null, valor_indeterminado: false, moneda: null, fecha_inicio: null, fecha_fin: null,
    requiere_poliza: null, tipo_poliza: "", estado_poliza: null,
    observaciones: [tipo === "cotizacion" ? "El adjunto es una cotización, no un contrato firmado" : "El adjunto no parece un contrato"],
    confianza: {},
  }
}

/** Similitud de Dice entre dos textos (palabras de más de 2 letras). */
export function similitud(a: string, b: string): number {
  const palabras = (s: string) => new Set(normalizar(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const pa = palabras(a)
  const pb = palabras(b)
  if (pa.size === 0 || pb.size === 0) return 0
  let comunes = 0
  for (const w of pa) if (pb.has(w)) comunes++
  return (2 * comunes) / (pa.size + pb.size)
}

export function slug(nombre: string): string {
  const sinSufijo = nombre.replace(/\s+(S\.?A\.?S\.?|S\.?A\.?C\.?|S\.?A\.?|S\. de R\.L\.|Ltda\.?)\s*$/i, "")
  return normalizar(sinSufijo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

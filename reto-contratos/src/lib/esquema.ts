import { z } from "zod"

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const
export const TIPOS_DOCUMENTO = ["contrato", "otrosi", "cotizacion", "otro"] as const

export type Pais = (typeof PAISES)[number]
export type Moneda = (typeof MONEDAS)[number]
export type EstadoPoliza = (typeof ESTADOS_POLIZA)[number]
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

/** Campos del maestro que se extraen con nivel de confianza. */
export const CAMPOS_CONFIANZA = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
] as const
export type CampoConfianza = (typeof CAMPOS_CONFIANZA)[number]

/** Campos sin los cuales un contrato nuevo no puede entrar al maestro. */
export const CAMPOS_OBLIGATORIOS_NUEVO: CampoConfianza[] = [
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
]

export const UMBRAL_CONFIANZA = 0.8

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD")

export const ContratoSchema = z.object({
  tipo_documento: z.enum(TIPOS_DOCUMENTO).describe("contrato, otrosi, cotizacion u otro"),
  id_contrato: z.string().nullable().describe("Número del contrato tal como aparece en el documento"),
  cliente: z.string().nullable().describe("Razón social de la contraparte"),
  nit_cliente: z.string().nullable().describe("Identificador tributario sin puntos ni dígito de verificación"),
  pais: z.enum(PAISES).nullable().describe("País del cliente"),
  objeto: z.string().max(200).nullable().describe("Objeto del contrato, máximo 200 caracteres"),
  valor: z.number().nonnegative().nullable().describe("Valor total sin separadores; 0 si es por demanda"),
  valor_indeterminado: z.boolean().describe("true si el contrato no tiene valor determinado"),
  moneda: z.enum(MONEDAS).nullable().describe("Moneda del valor"),
  fecha_inicio: fechaISO.nullable().describe("Fecha de inicio YYYY-MM-DD"),
  fecha_fin: fechaISO.nullable().describe("Fecha de fin YYYY-MM-DD"),
  requiere_poliza: z.boolean().nullable().describe("true si el contrato exige póliza"),
  tipo_poliza: z.string().describe("Tipos de póliza separados por ';' (vacío si no aplica)"),
  estado_poliza: z.enum(ESTADOS_POLIZA).nullable().describe("vigente, pendiente, vencida o no_aplica"),
  comercial: z.string().nullable().describe("Nombre del comercial resuelto desde comerciales.json"),
  remitente: z.string().describe("Correo del remitente del mensaje"),
  archivo: z.string().nullable().describe("Nombre del adjunto que contiene el documento"),
  observaciones: z.array(z.string()).describe("Notas de la extracción (supuestos, advertencias)"),
  confianza: z
    .record(z.string(), z.number().min(0).max(1))
    .describe("Confianza por campo entre 0 y 1"),
})
export type Contrato = z.infer<typeof ContratoSchema>

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})
export type Correo = z.infer<typeof CorreoSchema>

export const ComercialSchema = z.object({
  email: z.string(),
  nombre: z.string(),
  region: z.string(),
})
export type Comercial = z.infer<typeof ComercialSchema>

/** Columnas del maestro, en el orden del CSV original. */
export const COLUMNAS_MAESTRO = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const
export type ColumnaMaestro = (typeof COLUMNAS_MAESTRO)[number]
export type FilaMaestro = Record<ColumnaMaestro, string>

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

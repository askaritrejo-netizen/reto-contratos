# SOLUCIÓN — Reto 2: Agente "Registro de Contratos Vigentes"

Autor: Askari Trejo · Octubre 2026

## 1. El problema en una frase

El maestro de contratos de Periferia está congelado desde el 30 de mayo de 2026 y solo recibe los contratos con póliza, así que **la dirección no sabe qué contratos están vigentes, cuáles vencen ni qué pólizas faltan**. Le duele a la analista administrativa (dueña del maestro), a gerencia (sin visibilidad del riesgo) y a la empresa (pólizas exigidas que nadie constituye).

## 2. Arquitectura

```
┌───────────────────────┐   HTTP (stream)   ┌───────────────────────────────────────────┐
│ Chat web (Next.js)    │ ────────────────▶ │ Backend: app/api/chat/route.ts            │
│ app/page.tsx          │ ◀──────────────── │  · ciclo del agente (AI SDK streamText)   │
│ · historial           │                   │  · tope de pasos y de tokens              │
│ · cada herramienta    │                   │  · adaptador LLM: src/llm/ (Anthropic)    │
│ · tarjeta amarilla de │                   │  · sesiones en archivo                    │
│   confirmación        │                   └──────────────┬────────────────────────────┘
└───────────────────────┘                                  │ llama
                                         ┌─────────────────▼─────────────────┐
                                         │ src/tools/contratos.ts (zod)      │  ◀── demo.ts (sin IA)
                                         │ leer_buzon · extraer · validar ·  │
                                         │ registrar · alertas               │
                                         └───────┬───────────────────┬───────┘
                                     solo lectura│                   │escritura
                                   fixtures/reto-02/             out/ (local) o /tmp (Vercel)
                                   (buzón, maestro,              sharepoint/maestro-contratos.csv
                                    comerciales)                 sharepoint/Contratos/<año>/<cliente>/
                                                                 sharepoint/historial.jsonl
                                                                 procesados.json · log.jsonl · alertas.md
```

| Capa | Dónde vive | Qué cambia aquí |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Cómo conversa el agente, orden de trabajo, formato de respuesta. |
| **Conocimiento** | `src/knowledge/registro-contratos.md` | Reglas de negocio explicadas (RN1–RN6, pólizas, archivo). |
| **Ejecución** | `src/tools/contratos.ts` + `src/lib/` | Las reglas reales, deterministas y probadas por `demo.ts`. |
| Servidor | `app/api/*` | Solo orquesta. Un cambio de regla de negocio no toca el servidor. |
| Proveedor IA | `src/llm/adapter.ts`, `anthropic.ts`, `proveedor.ts` | Cambiar de proveedor = otra implementación + una línea. |

**Despliegue:** Vercel. Como Vercel no deja escribir en la carpeta del proyecto, el "SharePoint" se escribe en `/tmp/reto-02-out` y el maestro se copia desde el fixture la primera vez (RN6). Los fixtures, el prompt y el conocimiento se leen del disco; si el servidor no los copió, se usan desde `src/generated/archivos.ts`, un paquete generado automáticamente en cada build a partir de los mismos archivos (nunca se edita a mano).

## 3. Ciclo del agente

1. El chat envía el historial a `POST /api/chat`.
2. El servidor arma el *system prompt* (comportamiento + conocimiento + fecha del sistema) y llama al modelo con las 5 herramientas (`streamText` del Vercel AI SDK).
3. El modelo decide qué herramienta usar; el backend **valida los argumentos con zod** antes de ejecutar (si no cumplen, devuelve el error al modelo) y le regresa el resultado. Se repite hasta que el modelo responde con texto.
4. **Tope de iteraciones (CA1):** `stopWhen: stepCountIs(25)` (configurable con `MAX_PASOS`). En el último paso permitido se desactivan las herramientas (`toolChoice: "none"`) para que el agente responda con lo que tiene y diga lo que falta.
5. **Confirmación humana (CA3):** `contratos_registrar` está declarada con `needsApproval: true`. El SDK **no la ejecuta automáticamente**: el turno termina, el chat muestra una tarjeta amarilla con todos los campos (los de baja confianza en rojo) y los botones *Confirmar y registrar* / *Rechazar*. Solo si la persona confirma, el siguiente envío ejecuta la herramienta con `confirmado = true`. Si rechaza, el modelo recibe la negativa y no insiste.
6. **Trazabilidad (CA4):** cada llamada se ve en el chat (nombre, argumentos, resultado resumido) y queda en `log.jsonl` con `{ ts, herramienta, mensaje_id, ok, resumen }`.
7. **Errores (CA5):** las herramientas nunca lanzan excepciones; devuelven `{ ok: false, error }` legible y el agente sigue con el siguiente mensaje. Los errores del proveedor (clave inválida, saturación, tiempo agotado a los 55 s) se traducen a lenguaje claro y la sesión sigue viva.
8. **Topes de costo:** máximo de pasos por turno, máximo de tokens por respuesta (4096) y máximo de tokens por conversación (≈ 90 000, configurable); al superarlo se pide abrir una conversación nueva.

## 4. Elección del modelo y costos

- **Proveedor:** Anthropic, vía `@ai-sdk/anthropic`.
- **Modelo:** `claude-haiku-5-5` por defecto (configurable con `ANTHROPIC_MODEL`, por ejemplo `claude-sonnet-5-5`).
- **Por qué Haiku:** el modelo **no extrae ni decide los valores**: eso lo hacen las herramientas con reglas. El modelo solo orquesta (qué herramienta llamar, en qué orden) y redacta el resumen. Para esa tarea un modelo rápido y barato basta, y además responde dentro del límite de 60 s por petición del plan gratuito de Vercel.

**Precios de referencia** (por millón de tokens; verificar en la página oficial de precios de Anthropic antes de producción):

| Modelo | Entrada | Salida |
|---|---|---|
| Claude Haiku 5.5 (prompts ≤ 100 k tokens) | USD 0.10 | USD 0.50 |
| Claude Haiku 5.5 (prompts > 100 k tokens) | USD 0.50 | USD 2.50 |
| Claude Sonnet 5.5 | USD 2.00 | USD 10.00 |

**Estimación por lote de 6 correos** (un turno "procesa el buzón"): ~6–8 pasos del modelo; el contexto crece de ~5 k a ~20 k tokens → **≈ 75 k tokens de entrada** acumulados y **≈ 10 k de salida** (incluye los contratos que el modelo reenvía como argumentos).

| | Por lote de 6 | Por caso | 1 000 contratos/año |
|---|---|---|---|
| Haiku 5.5 | ≈ USD 0.013 | ≈ USD 0.002 | ≈ USD 2 |
| Sonnet 5.5 | ≈ USD 0.25 | ≈ USD 0.04 | ≈ USD 40 |

Decisión de costo: el tope de sesión (≈ 90 k tokens) mantiene cada petición por debajo del umbral de 100 k en el que Haiku cobra 5 veces más. La verificación `demo.ts` cuesta **cero**: no usa modelo.

## 5. Estrategia de extracción

Toda la extracción es **determinista** (`src/lib/extraccion.ts`): expresiones regulares y reglas sobre el texto del contrato. El modelo no interviene en ningún valor que se registra.

| Campo | Cómo se encuentra | Confianza |
|---|---|---|
| Tipo de documento | Primera línea: "CONTRATO", "OTROSÍ", "COTIZACIÓN" | — |
| `id_contrato` | `CONTRATO … No. XX-AAAA-NNN` (en un otrosí, el contrato al que modifica) | 0.95 |
| Cliente | Primera parte de "Entre …"; se toma la versión bien escrita del bloque de firmas si coincide | 0.95 (0.85 sin firma) |
| NIT / RUC | Primer NIT/RUC/RTN que no es el de Periferia; sin puntos ni dígito de verificación | 0.95 |
| País | Tipo y largo del identificador (RUC de 13 dígitos = EC, de 11 = PE…) cruzado con la ciudad del domicilio | 0.95 si coinciden, 0.85 si solo hay uno |
| Objeto | Cláusula OBJETO, sin la fórmula "EL CONTRATISTA se obliga a", máx. 200 caracteres | 0.9 |
| Valor y moneda | Cláusula VALOR (en mayúsculas, para no confundir con montos de garantías), código de moneda + cifra; separadores de miles/decimales interpretados | 0.95 |
| Valor por demanda | "no tiene un valor determinado" → valor 0, `valor_indeterminado = true` | **0.5** (siempre revisión) |
| Fechas | Cláusula PLAZO: "desde … hasta …" con fechas en letras y números | 0.95 |
| Plazo en meses | "N meses desde X" → fin calculado | 0.85 |
| Plazo desde la firma sin día | Día tomado de la fecha del correo (0.8); fin calculado al cierre del mes (0.6) | **0.6** (revisión) |
| Póliza | Cláusula GARANTÍAS: tipos (cumplimiento, calidad, responsabilidad civil, salarios…); condicional → no aplica con observación; en un otrosí que pide ampliarlas → `pendiente` | 0.8–0.95 |
| Comercial | Correo del remitente contra `comerciales.json`; desconocido → aviso, no bloquea | — |

**Campo ausente → `null` con confianza 0**, nunca inventado. **Confianza < 0.8 → `requiere_revision`** y `contratos_registrar` lo rechaza sin `confirmado = true` (RN5).

**Dónde entra el modelo y dónde no:** entra para conversar, decidir el orden de las herramientas, explicar lo que requiere revisión y resumir. **No entra** en extraer, clasificar, decidir duplicados ni escribir: eso es lo que permite que `demo.ts` dé siempre el mismo resultado.

## 6. Regla de gobierno: "Ningún contrato vive fuera del maestro"

**Alcance:** todo contrato, otrosí, acta de inicio, prórroga o acta de terminación que firme Periferia con un cliente, **con o sin póliza**.

1. **Canal único.** Todo documento se envía a **contratos@periferia.com** (buzón compartido). Lo administra la **Analista Administrativa de Contratos**, que es la **dueña del maestro**; su respaldo es la Coordinación Administrativa (cubre ausencias y rotación, para que el proceso no muera con una persona). El agente lee el buzón; nadie más carga contratos al maestro.
2. **Obligación del comercial.**
   - Qué: el PDF **firmado por ambas partes**, sus otrosíes, prórrogas y actas de terminación. Las cotizaciones y borradores no se envían a este buzón.
   - Cuándo: dentro de los **3 días hábiles** siguientes a la firma.
   - Formato del asunto: `[CONTRATO|OTROSI|TERMINACION] <Cliente> - <No. de contrato> - <Póliza: SI/NO>`. Ejemplo: `[OTROSI] Minera Los Andes - CT-2026-011 - Póliza: SI`.
   - El envío lo hace el comercial titular registrado en el catálogo. Si lo envía otra persona (por ejemplo un practicante), debe copiar al titular.
3. **Acuse automático.** En menos de **1 hora hábil** el agente responde al remitente con: número asignado, clasificación (nuevo, actualización, duplicado, rechazado), datos extraídos y, si aplica, los campos que la analista está verificando. Al registrarse, envía la confirmación con la ruta en SharePoint.
4. **Excepciones y escalamiento.**
   - Contrato sin firmas, sin valor o con fechas incompletas: se registra como **pendiente de revisión** (nunca se inventan datos) y se pide al comercial completarlo en 2 días hábiles.
   - Sin respuesta en 2 días → se escala al **jefe comercial de la región**; a los 5 días → a la **Gerencia Administrativa y Financiera**.
   - Contrato que exige póliza: la analista solicita la póliza al corredor el mismo día; si no está **vigente en 10 días hábiles**, se escala a Gerencia.
   - Contrato marco o por demanda: se registra con valor 0 y cada orden de servicio se envía igual que un otrosí.
5. **Cierre del gap (junio–agosto de 2026), en una sola campaña de 2 semanas.**
   - Semana 1: Finanzas extrae el listado de clientes **facturados** entre el 1 de junio y el 31 de agosto. Se cruza contra el maestro: cada cliente facturado sin contrato vigente queda en una lista de faltantes por comercial.
   - Cada comercial reenvía al buzón los contratos de su lista con el asunto `[CONTRATO] … ` y la etiqueta `MIGRACION`. El agente los procesa igual que los nuevos (fuente `migracion`).
   - Semana 2: la analista confirma los casos en revisión; los que sigan faltando se escalan a la gerencia comercial. La campaña cierra con un acta y el reporte de alertas.
6. **Indicador mensual (prueba de que el proceso vive).**
   **Cobertura del maestro = clientes facturados en el mes que tienen un contrato vigente en el maestro ÷ total de clientes facturados en el mes.** Meta: ≥ 95 %. Se complementa con: tiempo promedio firma → registro (meta ≤ 3 días hábiles) y número de pólizas exigidas no vigentes (meta: 0 con más de 10 días).

**Consecuencia del incumplimiento:** un contrato que no está en el maestro no se puede facturar ni liquidar comisión hasta que se registre.

## 7. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | Extracción **100 % por reglas**; el modelo no fija valores. | Extracción con el modelo (más flexible con formatos raros). | El PRD pide que el valor registrado salga de una herramienta y que `demo.ts` sea determinista. Las reglas se auditan línea por línea; el modelo puede "redondear" o inferir. Costo: un formato muy distinto bajaría la confianza y caería en revisión humana (que es el comportamiento seguro). |
| 2 | Confirmación con **aprobación nativa del SDK** (`needsApproval`) para **todo** registro, no solo los dudosos. | Pedir confirmación solo cuando `requiere_revision` no está vacío; o pedirla por texto ("escribe confirmo"). | Escribir en el maestro es irreversible para el negocio; un clic por contrato es barato. Los botones evitan que el modelo interprete mal un "sí". La regla RN5 se mantiene igual dentro de la herramienta (y la prueba `demo.ts`). |
| 3 | Duplicados y rechazados se cierran en `contratos_validar`. | Cerrarlos con `contratos_registrar` (pediría confirmar algo que no escribe). | No escriben en el maestro, así que no requieren confirmación; solo se marcan como procesados y se reportan. |
| 4 | SharePoint simulado en `/tmp` en Vercel + copia empaquetada de los fixtures. | Base de datos o almacenamiento externo (Blob, KV). | El PRD excluye bases de datos. Contra: `/tmp` es por instancia y se borra al reciclarse (ver riesgos). |
| 5 | Haiku 5.5 por defecto. | Sonnet 5.5. | El modelo solo orquesta; Haiku es ~20 veces más barato y más rápido (cabe en 60 s). Se cambia con una variable si se necesita más razonamiento. |
| 6 | Next.js + Vercel AI SDK. | Servidor HTTP propio con Bun y HTML plano. | Despliegue en un clic en Vercel, streaming y manejo de herramientas/aprobaciones ya resueltos. Contra: más dependencias. |

## 8. Supuestos

- La "fecha de corte" del maestro es 2026-05-30; "registrados desde el corte" = `fecha_registro` posterior a esa fecha.
- La fecha de referencia de la demo es 2026-09-03 (la del prompt de ejemplo del PRD).
- `fecha_fin` explícita se toma tal cual; con plazo en meses y fecha de inicio, fin = inicio + N meses − 1 día (convención del maestro).
- msg-006: el contrato dice "agosto de 2026" sin día; se toma el día del correo (31) como inicio y el cierre de mes como fin (2027-08-31). Por eso va a revisión.
- Un otrosí que pide ampliar las garantías deja la póliza en `pendiente` hasta que se renueve.
- Una póliza condicional (solo para órdenes de más de COP 100 M) no hace que el contrato marco requiera póliza; se deja la observación.
- Los adjuntos `.txt` son el texto ya extraído del PDF; se archivan con su extensión original.
- Remitente desconocido → se registra el comercial como "No registrado (correo)".

## 9. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | Hecho | Conexión real a Exchange/Graph. |
| HU-2 Extraer con confianza | Hecho (texto) | Lectura de PDF nativo (P1) y OCR para escaneos. |
| HU-3 Validar y clasificar | Hecho (RN1–RN5) | Normalizar razones sociales con un catálogo de clientes. |
| HU-4 Registrar y archivar | Hecho | Escribir en SharePoint real (Graph API) con control de versiones. |
| HU-5 Alertas | Hecho | Envío programado semanal a gerencia. |
| HU-6 Manejo de errores | Hecho | Reintentos automáticos ante caídas del proveedor. |
| Front con herramientas y confirmación | Hecho | Autenticación de usuarios. |
| `demo.ts` sin modelo | Hecho (Node y Bun) | — |
| Bonus `modulo/` | Hecho | `modulo/agent.md` y `SKILL.md` se generan en cada build desde las mismas fuentes; `modulo/tools` reexporta las herramientas. |

## 10. Uso de IA para construir

- **Claude (Anthropic)**, en una conversación guiada: leyó el PRD y los 6 correos, propuso la arquitectura, escribió el código, ejecutó `demo.ts` para verificar los 6 casos (Node y Bun, dos veces seguidas para comprobar el determinismo) y redactó la documentación. Mi papel: definir el enfoque (Next.js + AI SDK + Anthropic, confirmación con botones, SharePoint en `/tmp`), revisar los resultados contra la tabla 7.4 del PRD y desplegar.
- **Qué se descartó:**
  - Usar el modelo para extraer los datos: descartado por determinismo y auditabilidad.
  - Pedir confirmación escribiendo "confirmo" en el chat: descartado por ambiguo; se usan botones.
  - Guardar el maestro en una base de datos externa: descartado porque el PRD lo excluye.
  - Bloquear el despliegue por la verificación de tipos: se dejó como comando aparte (`npm run typecheck`) para que un detalle de tipos no impida publicar el link.

## 11. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| `/tmp` en Vercel es por instancia y se borra: dos peticiones pueden ver maestros distintos y los registros se pierden al reciclar. | En producción, SharePoint real vía Microsoft Graph (o almacenamiento persistente). Para la demo, el botón "Reiniciar SharePoint" deja todo en estado conocido. |
| Formatos de contrato distintos a los del reto. | Baja la confianza → revisión humana, nunca dato malo. Ampliar reglas con cada caso real; usar el modelo solo para **proponer** valores que la persona confirma. |
| PDFs escaneados. | OCR antes de la extracción. |
| Falsos duplicados por nombres distintos del mismo cliente. | El emparejamiento se hace por número de contrato y NIT, no por nombre. |
| El modelo "redondea" o inventa un valor. | Los valores registrados vienen de la herramienta; la tarjeta de confirmación muestra exactamente lo que se escribirá. |
| Abuso de la clave (link público). | Topes de pasos, tokens por respuesta y por sesión; en producción, autenticación y límite por usuario. |
| Datos personales y confidenciales en contratos. | Clave solo en el servidor; en producción, acceso con cuenta corporativa y bitácora (`log.jsonl` ya registra cada acción). |
| Dependencia de una persona (el problema original). | La regla de gobierno define dueño, respaldo, plazos, escalamiento e indicador mensual. |

---
name: registro-contratos
description: Reglas de negocio y conocimiento del proceso de registro de contratos vigentes de Periferia (RN1-RN6, pólizas, archivo y alertas)
---

# Conocimiento del proceso: registro de contratos vigentes

## Contexto
- El maestro de contratos vive en SharePoint (aquí simulado como `sharepoint/maestro-contratos.csv`). Estuvo congelado desde el **2026-05-30** porque lo alimentaba una persona que ya no está.
- Antes solo llegaban a administración los contratos que exigían póliza. Ahora **todo** contrato debe registrarse, con o sin póliza.

## Reglas de negocio (PRD 7.3)
- **RN1 Duplicado**: mismo `id_contrato` y mismos `valor`, `fecha_inicio`, `fecha_fin` → no se escribe nada, se reporta.
- **RN2 Actualización**: mismo `id_contrato` (o mismo NIT + objeto con similitud ≥ 0.9) con algún campo distinto, o un otrosí → se actualiza la fila y queda historial en `sharepoint/historial.jsonl`.
- **RN3 Nuevo**: sin coincidencia → se inserta.
- **RN4 Rechazado**: sin adjunto de contrato (por ejemplo una cotización) o sin partes ni objeto identificables → se reporta con motivo.
- **RN5 Revisión humana**: campos con confianza < 0.8 detienen el registro hasta que la analista confirme.
- **RN6**: el maestro original es de solo lectura; se trabaja sobre una copia.

## Pólizas
- Contrato nuevo que exige póliza → `estado_poliza = pendiente` hasta que la aseguradora la constituya.
- Contrato sin póliza → `no_aplica`.
- Otrosí que amplía plazo de un contrato con pólizas → las pólizas deben ampliarse; quedan `pendiente`.
- Póliza condicional (solo para órdenes que superen un monto) → el contrato marco queda `no_aplica` con una observación.

## Contratos marco y por demanda
- Sin valor determinado → `valor = 0` y `valor_indeterminado = true`. Siempre requiere confirmación humana.
- Plazo en meses sin fechas explícitas → la fecha fin se calcula y requiere confirmación humana.

## Comerciales
- El autor se resuelve con `comerciales.json` usando el correo del remitente.
- Remitente desconocido (por ejemplo un practicante) → se reporta como "No registrado (correo)", pero no bloquea el registro.

## Archivo en SharePoint
- Ruta: `Contratos/<año de inicio>/<cliente-sin-sufijo-societario>/<id_contrato>.<ext>`.
- Los otrosíes se archivan junto al contrato como `<id_contrato>_otrosi_<mensaje>.<ext>`.

## Alertas
- Contratos que vencen en 60 días o menos desde la fecha de referencia.
- Contratos con póliza exigida cuyo estado no es `vigente`.
- Contratos registrados después del corte del 2026-05-30 (gap cubierto).

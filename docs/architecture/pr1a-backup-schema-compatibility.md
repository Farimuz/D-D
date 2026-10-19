# PR 1-A — Compatibilidad de backups y lectura de esquemas antiguos

**Fecha:** 2026-10-18 (correcciones; antecedente PR 1-A del 2026-10-17). **Estado:** correcciones controladas AUD-01/AUD-02 implementadas localmente; **no fusionado**, sin despliegue y pendiente de nueva auditoría separada sobre el commit corregido.

## Alcance real

La base integrada al inicio de PR 1-A es `main` en `a70014a152a0e763aed6ebdc99a226362b2891ca`, esquema SQLite 3 y formato de backup `dnd-backup` versión 1.

Este PR **no introduce** tablas de cuentas, personajes o campañas, **no eleva aún `SCHEMA_VERSION`**, y no modifica el protocolo, `RoomState`, los permisos ni la UI.

### Problema que resuelve

Antes, `backup.ts` exigía `manifest.schemaVersion === SCHEMA_VERSION` y `initializeSchema()` rechazaba toda lectura de esquema anterior, incluso en modo `readOnly`. Un binario futuro v4 rechazaría automáticamente copias legítimas v3, a pesar de que las tablas históricas de salas, accesos y assets se mantuviesen compatibles.

### Cambios

- Se establece `MIN_RESTORABLE_BACKUP_SCHEMA_VERSION = 3`: solo un subconjunto **explícitamente admitido** de esquemas antiguos se inspecciona en modo read-only. Las versiones v1/v2 siguen requiriendo migración de inicio; **no** se declaran backups válidos v1/v2.
- `initializeSchema` distingue lectura de snapshot de migración: la lectura antigua admitida no ejecuta DDL ni modifica `PRAGMA user_version`. Abrir la base en **modo escritura** sigue realizando las migraciones necesarias dentro de la transacción.
- `manifestValue` acepta únicamente enteros seguros de esquema entre 3 y la versión actual, con formato de backup 1 conocido; rechaza versiones futuras o anteriores al mínimo.
- `checkSnapshot` contrasta el SHA-256 declarado, el `schemaVersion` del manifiesto y el `PRAGMA user_version` **real** del archivo. Antes de crear el destino se rechazan discrepancias y leases de runtime.
- `restoreBackup` conserva su flujo de copia inmutable, rotación de `storage_identity`, comprobación y publicación del destino. Una copia histórica puede restaurarse conservando el esquema original; el siguiente inicio **escribible** realizará la migración. Nunca se migra la carpeta fuente del backup.

**Contrato para PR 1-B:** si la futura v4 cambia la forma de registros o introduce entidades adicionales, sus lectores de snapshots v3 deben seguir verificando lo histórico, y la comprobación de integridad de v4 debe extenderse a todas las tablas nuevas. No presuponer que esta preparación ya prueba una v4 real.

## Correcciones controladas de la auditoría independiente

La auditoría del HEAD `1b1a0395f225f9a784cd72d4ed47f17c34cbca5d` produjo `CHANGES_REQUIRED`. AUD-01 y AUD-02 también se reprodujeron en la base `a70014a...`: son defectos heredados dentro de esta ruta, no regresiones nuevas atribuidas al PR. La corrección mantiene esquema 3, formato de backup 1, core/protocolo/permisos y dependencias.

### AUD-01 — Solo snapshots standalone íntegros

Antes de abrir SQLite se comprueban bytes de cabecera (firma y versiones de lectura/escritura rollback, offsets 18/19) y ausencia de `rooms.sqlite-wal`, `-shm` y `-journal`. `lstat` detecta también enlaces colgantes. Cualquier sidecar, incluso vacío, o cabecera WAL produce `BACKUP_NOT_STANDALONE` sin crear destino ni intención de restore. No se hace checkpoint, migración, eliminación de archivos ni reparación sobre la fuente.

El hash usa el descriptor del archivo regular verificado; vuelve a comprobar cambios y sidecars al terminar la lectura. La validación usa `integrity_check` completo, no solo `quick_check`, para incluir contenido de índices; al cerrar los lectores contrasta otra vez el snapshot. La conversión a standalone de `createBackup` sigue limitada al snapshot nuevo que ese comando posee, nunca al bundle de entrada a restore.

### AUD-02 — Estructura esencial v3

`initializeSchema` comprueba las seis tablas esenciales con `table_list`, `table_xinfo`, `index_list`, `index_xinfo` y `foreign_key_list`: tablas STRICT con rowid, columnas/tipos/nulabilidad, PK efectiva, índice PK binario no parcial y relación `room_access.room_id → rooms.id ON DELETE CASCADE`. Se usan sentencias PRAGMA directas, no tablas SQL `pragma_*` que el archivo podría suplantar; los nombres de índices se escapan como identificadores. Se rechazan índices únicos adicionales y triggers sobre tablas esenciales porque alteran los contratos de escritura. Los datos de identidad y lease conservan sus invariantes de singleton y formato.

No se comparan textos SQL ni nombres de constraints. Los CHECK históricos no se exigen por su escritura textual; se mantienen la validación de datos y los controles referenciales. En particular, una tabla rooms procedente de v1 puede carecer de su CHECK de storage_version y sigue admitiéndose si los valores son válidos. La estructura resultante de migraciones 0/1/2→3 se comprueba dentro de la misma transacción, antes del commit: un v2 incompleto no puede consolidar identidad/versionado nuevos.

### Evidencia de la corrección y límites

Se confirmaron de nuevo los escenarios originales con datos sintéticos antes de editar. La primera ejecución del nuevo archivo de regresión, aún contra la implementación anterior, terminó con 17 fallos y 5 pases; se conserva como evidencia roja. Con la versión definitiva pasaron 66/66 pruebas dirigidas sobre Node 22.18.0 / SQLite 3.50.2 y 52/52 integraciones en Windows x64, sin omisiones. El fixture adicional de índices tuvo dos fallos de preparación conservados: primero un número de entradas incorrecto; después, la primera regresión Node 24 se detuvo con 188/189 unidades porque ese runtime prohíbe editar sqlite_schema. El fixture final intercambia páginas de dos índices en una base sintética cerrada, sin desactivar el modo defensivo. Ninguno de esos dos fallos se atribuye al producto ni se elimina del registro.

`backupValidation.test.ts` construye v3 desde DDL congelado de la base histórica, sin usar el migrador actual para generar la estructura que pretende comprobar. Cubre SQL reformateado/citado, rooms migrado de v1, páginas de 64 KiB, datos privados/estado/revisión/assets exactos, identidad nueva y cascade operativo. Los negativos comprueban árbol fuente intacto y ausencia tanto del destino como de intención de restore.

La segunda regresión Node 24 aprobó 189 unidades y 52 integraciones y se detuvo deliberadamente durante navegadores: la revisión del corrector reprodujo que una tabla `pragma_table_list` falsa podía ocultar la ausencia de rowid en recibos. La prueba dirigida de ese escape falló antes del ajuste; se reemplazaron las consultas por PRAGMA directo y se añadió la regresión correspondiente. Esa ejecución parcial no se presenta como una aprobación integral.

La regresión final de Node 24.22.0 / SQLite 3.53.4 terminó con **521 aprobadas: 190 unidades, 52 integraciones, 266 E2E y 13 multijugador**, sin fallos ni omisiones. `npm ci` y build aprobaron; los estados finales de ambos conjuntos Playwright son `passed` y no contienen pruebas fallidas. Los hashes de implementación y pruebas permanecieron iguales desde el inicio de esa ejecución hasta su comprobación final. La documentación de resultados se completó después. Las pruebas Windows de alias 8.3 se ejecutaron, no se omitieron. Los avisos de colores observados en Playwright se conservaron como warnings, no como fallos de producto.

La reejecución por el corrector de los probes originales rechaza WAL online/offline con `BACKUP_NOT_STANDALONE` y las estructuras defectuosas con `SCHEMA_SHAPE`, antes de crear destino y conservando la fuente. La matriz original de fallos, recuperación y carreras entre procesos volvió a pasar 62/62. Esto aporta evidencia antes/después, pero no sustituye la revisión separada.

No hay distribución WSL instalada ni se detectó CLI Docker en PATH: no se atribuye ejecución Linux a estas correcciones. Los resultados Ubuntu previos del PR son antecedentes, no pruebas del código corregido. El coste adicional de hash/verificación completa no se ha medido con el máximo de las cuotas. Siguen requiriéndose directorios privados del operador y una fuente inmutable; no se ofrece aislamiento absoluto frente a otro proceso hostil bajo la misma cuenta.

Esta es implementación y revalidación del corrector, **no una auditoría independiente exitosa**. PR #9 debe permanecer en borrador y el commit corregido requiere revisión separada; no se implementa v4 ni PR 1-B.

## Evidencia preliminar histórica del implementador

El texto siguiente conserva el estado preliminar anterior al CI y a la corrección controlada: no hubo acceso a un checkout completo ni a la instalación de dependencias de la suite del repositorio en aquel entorno. Se reconstruyó para pruebas locales **un subconjunto del árbol** usando fuentes de la auditoría histórica v0.0.5 y los cambios de esta rama, con pequeñas equivalencias de módulos auxiliares de tablero. Se usó Node **22.16.0** (inferior al mínimo soportado 22.18.0); entonces la compilación y suite completas **no** se ejecutaron.

| Prueba dirigida (entorno reconstruido) | Resultado |
| --- | --- |
| `sqliteRoomStore.test.ts` histórico sobre código de persistencia con la modificación actual de esquema, incluida prueba nueva de lectura read-only no migratoria | 20/20 aprobadas |
| Harness aislado con clases reales de `SQLiteRoomStore`, `FilesystemAssetStore` y `backup.ts`: roundtrip de sala/acceso/imagen; versión incompatible; metadatos de esquema falsos y checksum recompuesto | 3/3 aprobadas |
| Harness adversarial: restauración interrumpida por inyección, checksum adulterado, verificación de esquema v3 | 3/3 aprobadas |
| Simulación de bump v3→v4 **sin tablas nuevas**: crear backup v3; incrementar la constante en una copia local; restaurar con binario simulado v4; abrir destino escribible y conservar sala/mapa/acceso, fuente intacta | Aprobada |

Estas pruebas aportan evidencia **limitada** de la ruta de compatibilidad, pero **no acreditan** la suite completa, un esquema v4 real, Windows, despliegue ni Linux/ARM64 operativo. No equiparar harness reconstruido con ejecución de todo `npm test` contra la rama GitHub.

### Auditoría adversarial de código

- Confirmado que un manifest con `schemaVersion` futuro, fraccional o inferior a 3 se rechaza antes de crear directorio destino.
- Confirmado que cambiar `PRAGMA user_version` y recalcular el checksum del backup no basta para engañar al validador.
- Confirmado que una restauración interrumpida conserva la copia fuente y deja marcadores que impiden servir el destino incompleto.
- Confirmado que la lectura histórica no modifica su schema y que el inicio escribible puede migrar el destino; **la lógica de migración v4 real aún no existe**.
- Riesgos pendientes: verificación de nuevas entidades en PR 1-B, prueba real con backup v3 y esquema v4 completo, suites en entorno soportado y robustez en plataforma destino.

## Requisitos antes de declarar PR 1-A listo para integrar

1. Ejecutar `npm ci`, `npm run build` y `npm test` con Node >=22.18 desde un **checkout completo de esta rama**, con cero regresiones inesperadas.
2. Repetir el escenario de backup/restore y fallos de almacenamiento contra código completo y assets reales de prueba, sin shims del harness aislado.
3. Revisar el diff contra `main` independientemente de quien lo implementó; resolver hallazgos.
4. Mantener PR 1-A en **borrador** hasta disponer de evidencia y una revisión satisfactoria. No modificar Oracle, Hermes ni `main`.
5. En PR 1-B, incorporar una prueba automatizada **real** de restauración de backup v3 bajo binario v4 y de integridad de sus futuras entidades nuevas.

**Este informe no declara la rama auditada para merge ni atribuye a CI pruebas que no se ejecutaron.**

# PR 1-A — Compatibilidad de backups y lectura de esquemas antiguos

**Fecha:** 2026-10-17. **Estado:** implementado en rama de revisión; **no fusionado**, sin despliegue y con validación incompleta de la suite integral.

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

## Pruebas y revisión efectuadas

No hubo acceso a un checkout completo ni a la instalación de dependencias de la suite del repositorio en este entorno. Se reconstruyó para pruebas locales **un subconjunto del árbol** usando fuentes de la auditoría histórica v0.0.5 y los cambios de esta rama, con pequeñas equivalencias de módulos auxiliares de tablero. Se usó Node **22.16.0** (inferior al mínimo soportado de 22.18.0); la compilación y suite completas **no** se ejecutaron.

| Prueba dirigida (entorno reconstruido) | Resultado |
| --- | --- |
| `sqliteRoomStore.test.ts` histórico sobre código de persistencia con la modificación actual de esquema | 19/19 aprobadas |
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

# D&D v0.0.5-B — Auditoría destructiva y pasada correctiva

Fecha de cierre: 2026-10-11. Rama: `feat/v0.0.5-portable-persistence`. Veredicto: **FASE_B_NEEDS_CORRECTION**. Los defectos altos demostrados de crecimiento durable y los defectos medios de contratos/recuperación/rutas fueron corregidos. Permanece la inestabilidad de integración paralela con Node 22.18.0 y un timeout E2E en iPhone emulado; sus causas no quedaron identificadas. Este informe no aprueba merge ni despliegue público.

## Metodología y alcance

Se trabajó en un clon aislado, sin campañas ni backups reales. Se leyó la misión y la documentación obligatoria completa: README, decisión 0003, portable-runtime, phase-a-audit, phase-b-persistence y multiplayer. La inspección inicial cubrió los 58 archivos del diff completo entre origin/main y el HEAD inicial, fuentes actuales, dependencias, tests, fixtures, launcher y recuperación. Las correcciones recibieron revisión funcional, de integración, adversarial, de seguridad/datos y de diff; se comprobó cada fallo y su resultado, incluidos los códigos distintos de cero.

Primero se repitieron instalación/build/regresión sobre la implementación recibida. Luego se reprodujeron hipótesis con cuotas artificialmente pequeñas, datos sintéticos y procesos propios. Los defectos confirmados recibieron tests que fallaron antes de su arreglo, correcciones temáticas y repeticiones. No se llenó el disco real. Dos subagentes revisaron con contexto nuevo y sin implementar; el segundo volvió a examinar toda B y construyó probes propios. Su independencia fue de contexto y comprobación, compartiendo host y checkout. Después de reportar hallazgos conoció las correcciones para repetir sus probes; no fue una auditoría ciega en infraestructura independiente.

Las terminaciones reales de Node se ejecutaron nativamente en Windows. Los fallos EPERM del sandbox se conservaron y se repitieron con permisos nativos autorizados: no se retiraron guardas para obtener verde. No se atribuyeron todos los fallos al sandbox. El informe y su paquete externo conservan logs positivos y negativos, scripts de probes y hashes. Los logs no se versionan junto al código; los nombres de evidencia aquí indicados corresponden al paquete entregado con el informe.

## A. Estado Git y entorno

| Dato | Estado comprobado |
| --- | --- |
| Remoto explícito | `https://github.com/Farimuz/D-D.git` |
| Rama única de trabajo | `feat/v0.0.5-portable-persistence` |
| HEAD recibido, limpio | `0206715ac23761877ba6869752a4470668efd846` |
| origin/main y merge-base inicial | `78e4b4fdc9d4ce7b0c73e121c53d06ee6f78612c` |
| Último commit aprobado de A | `c172c7f040dc82ff9dc249cfb3a11defa2812c33` |
| Última fuente de producción auditada | `4b9d8030ee711525b315ab5e418978c0c874817b` |
| Código y fixtures de regresión final | `3587552379f64f59ef52a922cc20603a69503518` |
| Runtime principal | Windows x64; Node 24.21.0; npm 11.19.0 |
| Runtime mínimo ejecutado | Node 22.18.0 oficial Windows x64, SHA256 verificado |
| Dependencias | 32 paquetes; TypeScript 7.0.2 / Vite 8.1.5; lockfile sin cambios |

Se ejecutó fetch antes de editar y se identificaron los siete commits de B posteriores a A: `30e3e2d` (SQLite), `bce8a3a` (coordinación), `361199e` (assets), `d07442f` (reinicios), `7a910c8` (backup), `7512971` (contención) y `0206715` (documentación). Se añadieron commits; no hubo rebase, reescritura de A, PR, tag, merge ni despliegue. El SHA del commit que contiene este documento y la comprobación remota final se registran en el informe externo para evitar una referencia circular al propio commit.

## B. Hallazgos contrastados

| ID | Severidad / clasificación | Demostración y resultado |
| --- | --- | --- |
| B-01 | ALTA — defecto confirmado, corregido | Crear/liberar runtime 25 veces dejó 25 salas durables, 0 activas y 25 recibos; 12 reemplazos con cleanup denegado dejaron 12 archivos/118128 bytes y una referencia. Tres backups y WAL de 321392 bytes mostraron crecimiento adicional. El límite activo no acotaba almacenamiento. |
| B-02 | MEDIA — defecto interno confirmado, corregido | Rechazo ASYNC_TRANSACTION seguido por continuación Promise borró una sala después de otro commit legítimo. Un callback declarado async se ejecutaba antes de ser rechazado. No se encontró ruta HTTP/WS que proporcionara callbacks asíncronos. |
| B-03 | MEDIA — defecto de disponibilidad confirmado, corregido | GET con UUID viejo/ajeno hacía lectura, hash y copia de un mapa de 25 MiB antes de 404. El revisor midió 149/115/126 ms. Ahora rechaza por metadata antes de leer bytes. |
| B-04 | MEDIA — defecto interno confirmado, corregido | Snapshot rechazado podía borrar después la sala, incluso tras una transacción legítima. El ámbito de revocación cubre también snapshot y operaciones SQLite/assets. |
| B-05 | MEDIA — defecto de recuperación confirmado, corregido | Fallo al abrir destino después de mkdir dejaba restore sin marcador; arrancaba vacío con 0 salas frente a 1 esperada. Intent en el padre previo a mkdir bloquea ese arranque. |
| B-06 | MEDIA — defecto de recuperación operacional confirmado, corregido | Interrumpir publicación entre hardlink del manifiesto y unlink dejaba nlink=2; el nuevo scanner de cuota impedía toda copia posterior con UNSAFE_FILE. La contabilidad por nombre conserva esa copia incompleta y permite otra si hay presupuesto. |
| B-07 | MEDIA — defecto de rutas Windows confirmado, corregido | Aliases 8.3 con mismo inode evitaban intent de restore y contención: backup dentro de assets, restore dentro del bundle. Identidad física native evita los tres casos sin ocultar symlinks a ManagedDirectory. |
| B-08 | MEDIA — inestabilidad confirmada, causa pendiente | Integración Node 22 con concurrencia predeterminada falla intermitentemente; en serie/dos workers y probes de arranque pasa. No se demostró corrupción de datos ni se identificó causa raíz. Impide aprobar esta fase. |
| B-09 | BAJA — límite interno conocido | Una Promise creada fuera del ámbito protegido puede continuar después del rechazo; casts/void pueden evadir tipos. No hay caller de producción demostrado con ese patrón. No se prometió cancelación general de JavaScript. |
| B-10 | OBSERVACIÓN — hipótesis refutada en probes | Hardlink de journal no alteró los 4480 bytes ni hash del archivo externo generado. Un nombre con punto final resultó otro inode, no alias. Los probes HTTP lentos liberaron buffers y pendingResponses=0; no prueban inmunidad general a OOM. |
| B-11 | MEDIA — riesgo no verificado en destino | Linux ARM64, energía física, reboot de VM y filesystem de red no ejecutados. No se conectó a Oracle. |
| B-12 | MEDIA — regresión final fallida, causa pendiente | E2E iPhone emulado agotó 30 s en page.reload del flujo de alineación. Las comprobaciones previas de geometría/guardado pasaron. Traza conserva documento tardío y JS/CSS pendientes; no se demostró defecto funcional de alineación ni causa específica. |

La clasificación media de B-02/B-04 evalúa el contrato de persistencia; no los convierte en vulnerabilidades remotas. El primer revisor calificó el mal uso interno como bajo. Ningún crítico o alto demostrado de integridad/privacidad/recuperación quedó pendiente en las fuentes revisadas; eso no demuestra ausencia de otros defectos.

## C. Correcciones y pruebas adversariales

| Commit | Causa y solución | Evidencia anterior/posterior |
| --- | --- | --- |
| `dfb0931` | Reject de Promise después de invocar no revocaba autoridad. Preflight async, ámbito AsyncLocalStorage revocable, detección de thenables y tipos SyncWork; otro store tampoco permite escape de contexto. | `transaction-red.log` (5 fallos), `transaction-types-red.log` (1 fallo); `transaction-green-final.log` (26 aprobadas). |
| `9928b11` | Getter de imagen se evaluaba antes de comprobar ID. Comprobación de metadata primero y eliminación de copia Buffer redundante. | `map-get-red.log` (1 fallo); `map-get-green.log` (20 aprobadas); probe final: tres 404, 0 lecturas; GET vigente 200, una lectura de 26214400 bytes. |
| `b960502` | Sin admisión global de datos ni poda de recibos. Límites configurables de salas, referencias, bytes físicos, DB/WAL/recibos/backups; status local de solo lectura. Mantiene campañas existentes y nunca borra por cuota. | `resources-red.log` (5 fallos); `resources-adversarial-final.log` (30 aprobadas), `resources-unit-final.log` (151 aprobadas). FULL, lector que fija WAL, cuota de huérfanos y recibo podado tras COMMIT incluidos. |
| `2b6116a` | Cobertura insuficiente de ventanas de crash en backup/restore/migraciones. Fixtures bloquean exclusivamente tras gates explícitos y el padre termina el proceso real. | `storage-crash-first.log` (20 aprobadas); `crash-integration-final.log` (63 aprobadas incluyendo suites relacionadas). |
| `8c66386` | Snapshot mantenía el mismo escape asíncrono y assets no comprobaba el ámbito. Helper Node compartido y guards en SQLite/assets; se refuerzan tipos de snapshot/admisión. | `snapshot-red.log` (2 fallos); `snapshot-green.log` (21 aprobadas); probe independiente final impide borrado por dos conexiones y asset, conservando revisión 4 y 9844 bytes. |
| `ef2d1a9` | Gap mkdir/marcador y uso incorrecto de validación de lectura para contabilidad de enlaces. Intent antes de mkdir; scanner cuenta cada nombre regular sin leer/borrar enlaces; gate manifestLinked. | `backup-gaps-red.log` (2 fallos); `backup-gaps-green.log` (35 aprobadas); probes independientes repiten ambos con fuente intacta. |
| `4b9d803` | Identidad lexical no coincide con identidad física 8.3. canonicalPath usa realpathSync.native y el ancestro existente; se mantienen rutas originales en validación de seguridad. | `restore-alias-red.log` y `backup-alias-red.log` (1 fallo cada uno); `restore-alias-green.log` (14 aprobadas), `aliases-green.log` (34 aprobadas), `aliases-final.log` (2 aprobadas); tres probes independientes finales verdes. |
| `3587552` | Diagnóstico insuficiente de arranque; el nuevo test GET no consumía cuerpos 404. Stages de fixture/causas de error y consumo explícito de respuestas, sin cambiar deadlines ni producción. | La repetición posterior de Node 22 predeterminada sigue 47/50: este commit no se presenta como arreglo de la inestabilidad. |

La revisión detectó problemas también en comprobaciones intermedias: una fixture de cuota usó 180000 bytes y permitía tres bundles, por lo que se corrigió el presupuesto controlado a 125000; una consulta nueva clasificaba JSON corrupto de manera diferente y se corrigió con json_valid conservando CORRUPT_STATE; un cleanup de fixture cerraba conexiones en orden incorrecto y produjo EPERM; el primer build del test de alias tuvo TS2339 y se corrigió una variable de cleanup. Sus logs (`resources-adversarial.log`, `resources-unit.log`, `transaction-green.log`, `aliases-build.log`) permanecen. Las repeticiones verdes no borran esos fallos. No se añadieron dependencias ni reglas del juego.

### Semántica de recursos

Defaults: 1000 salas persistidas, 1 GiB de assets referenciados distintos, 1280 MiB de archivos de assets, 256 MiB DB, umbral de WAL 64 MiB, 1024 recibos y pool de backups 2 GiB. CLI/env y operación se detallan en [phase-b-persistence](phase-b-persistence.md). Diez salas activas siguen siendo otro límite.

La admisión de salas/referencias se hace dentro de BEGIN IMMEDIATE. Se rechaza el nuevo mapa antes de preparar bytes si crece sobre cuota; reemplazos sin crecimiento pueden continuar. Huérfanos/temporales/desconocidos cuentan en cuota física. Se conservan mapas confirmados cuando cleanup falla. recoverAssets verifica todas las referencias antes de limpiar solo assets propios sin referencia; no elimina campañas ni backups para obtener espacio.

max_page_count limita páginas nuevas, sin encoger DB existente. maxWalBytes es umbral de admisión y checkpoint, no un límite físico exacto: una transacción puede superarlo; un lector externo puede bloquear TRUNCATE y entonces se rechazan nuevas escrituras hasta liberarlo. El revisor observó 24752 bytes con umbral 4096, y 103032 tras una operación grande. No se prometió que quota de DB + WAL equivalga a todo el volumen ni que dos DB distintas compartiendo pool estén serializadas globalmente. Los backups del mismo store se admiten bajo su writer lock, con reserva de DB asignada + referencias + margen de manifiesto, contando completos e incompletos.

Si otro writer poda el recibo actual entre COMMIT y reconciliación, ausencia no equivale a rollback: el store entra en incertidumbre salvo evidencia suficiente. No hay replay automático. Cualquier herramienta que escriba raw SQLite/FS y el propio operador pueden eludir estas cuotas; no son aislamiento entre cuentas del host.

## D. Integridad durable y recuperación

| Invariante / adversario | Evidencia ejecutada y límite |
| --- | --- |
| BEGIN/COMMIT/ROLLBACK y errores de escritura/privados/creación | SQLite/durableRooms/durableTransport verifican estado, acceso y revisiones previas ante rechazo. No broadcast antes de commit. Fallo posterior con recibo sigue exitoso una sola vez. Reconciliación/rollback fallido informa COMMIT_UNCERTAIN, cuarentena y reapertura. |
| Dos conexiones/escritores, CAS y locks | Tests de SQLite y Rooms conservan cambios/joins/renombres con storage_version distinto de board.revision; BUSY/CONFLICT no provoca sobrescritura ni retry automático. Backup excluye mutaciones durante snapshot/copia. Un servidor por DB continúa siendo la arquitectura. |
| Publicación de asset | Temporal exclusivo → escritura completa → fsync → hardlink exclusivo → verificación → referencia/metadata SQLite → COMMIT → cleanup. Antes de commit conserva mapa anterior; después conserva nuevo. No existe una transacción atómica conjunta SQLite/filesystem. |
| Terminación real de assets | Gates: asset.beforePrepare, asset.partialWrite, asset.sync, asset.published, asset.prepared, sqlite.commit, sqlite.afterCommit, asset.cleanup y asset.delete. Reinicio nuevo recupera último mapa confirmado/bytes y limpia solo huérfanos propios verificables. |
| Asset compartido / corrupto / desconocido | Dos salas con el mismo asset lo retienen hasta perder la última referencia. Referencia ausente/corrupta detiene recovery antes de borrar; desconocidos se preservan. Denegación de cleanup posterior conserva éxito y permite mantenimiento posterior. |
| Terminación real de backup | Gates: backup.snapshot, backup.copy, backup.asset, backup.publish y backup.manifestLinked. Fuente intacta, bundle incompleto no restaurable, siguiente backup válido posible si hay cuota; roundtrip de esa copia real. |
| Terminación real de restore | Gates: restore.created, restore.snapshot, restore.asset, restore.verify y restore.publish. Destino bloqueado incluso antes del flag local; fuente/bundle conservan hashes. Mismo destino rechazado; uno nuevo restaura exacto. |
| Migración V1/V2 real terminada | SIGKILL durante sqlite.migrate conserva versión/DDL/datos antiguos y quick_check=ok; reapertura migra. También se prueban vacío, V3, futuro, JSON/acceso inválidos; no se inventan versiones históricas. |
| Backup consistente y restauración | Snapshot con writer lock, copia cerrada/inmutable, manifest/checksum/schema/identidad/referencias verificadas. Manipulación, assets ausentes y formatos futuros se rechazan. Original puede cambiar después del backup: restore conserva revisión/bytes de la copia, no los posteriores. |
| Lifecycle y acceso tras reinicio | Cerrar/desconectar/liberar runtime conserva campañas. DM+dos jugadores atraviesan procesos diferentes, cierre normal/abrupto y restore; IDs/asignaciones/niebla/Solo DM/revisión/bytes exactos y presencia reconstruida desconectada. Borrado durable requiere operación explícita. |

Son 9 gates de assets + 5 de backup + 5 de restore + 2 de migración: 21 ventanas de terminación de procesos, además de las comprobaciones de gaps y lifecycle. SIGKILL en Windows representa terminación abrupta del proceso Node; no demuestra resistencia a pérdida de energía, reboot de VM o fallo físico del disco. En Linux se implementa fsync de directorios; aquí no se ejecutó ese camino. Windows no ofrece la misma sincronización portable de directorio por Node.

## E. Seguridad, autorización y portabilidad del core

Traversal, symlinks/junctions, hardlinks de archivos externos generados, colisiones, directorios reemplazados, lectura/borrado tras cambios de ruta y descriptor/inode se ejercitaron en tests nativos. Los aliases Windows 8.3 se verificaron con mismo inode y realpathSync.native; aquí sí se ejercitaron, sin skips. La ruta raw sigue llegando a ManagedDirectory, de modo que resolver una identidad para comparar no oculta un enlace que deba rechazarse. Las pruebas no alteraron archivos ajenos a los datos temporales generados.

ACL privada y almacenamiento local siguen siendo requisitos del operador. Windows usa checks de ancestros/descriptores; Linux usa /proc/self/fd y permisos del directorio, camino no ejecutado en esta auditoría. Los checks Node no son aislamiento absoluto frente a un proceso hostil con la misma cuenta, privilegios administrativos o escritura raw. Backups contienen hashes privados: checksum prueba integridad respecto del manifiesto, no autenticidad criptográfica frente a un operador que pueda reemplazar todo el bundle. No hay firma/cifrado nuevo ni recuperación de credenciales plaintext.

Tests de core, transporte, reinicios y multijugador comprueban actor DM/jugador, mensajes manipulados, identidades distintas, aislamiento entre salas, cuatro sockets por identidad/DM, diez participantes y límite global de conexiones. Proyecciones construidas por whitelist conservan niebla/Solo DM y no contienen hashes, credenciales ni asociaciones privadas. No se encontró logging de esos secretos en producción; los probes utilizan únicamente credenciales sintéticas. El mapa completo continúa disponible por diseño previo; la niebla es visual y no oculta los bytes del mapa a quien conoce su URL.

La auditoría transitiva y el test de bundle neutral mantienen el core sin node:*, SQLite, filesystem, HTTP, WebSocket, React, env ni rutas físicas. MemoryRoomStore sigue copiando JSON y pasando el flujo de sala. Las correcciones desde el HEAD inicial no modifican src/core, reglas, frontend ni protocolo. Los adaptadores Node contienen quotas/configuración/ALS/rutas, conforme a decisión 0003.

El probe de CLI final (`cli-final.log`) ejecutó status/backup/restore reales sobre una sala generada: status no alteró el hash de la DB ni incluyó campos privados; restore conservó registros privados exactos, revisión 1 y mapa de 9844 bytes. No es una prueba de instalación pública.

## F. Pruebas y evidencia

### Línea base repetida antes de editar

npm ci pasó en 5.722 s y build en 8.115 s. El primer npm test dentro del sandbox descubrió 134 unidades: 96 aprobadas/38 fallidas EPERM; no continuó con las demás suites. Se conservó `baseline-full.log` (exit 1, 9.644 s de workflow). La repetición nativa completa `baseline-native-full.log` pasó en 940.530 s, exit 0:

| Suite Node 24 inicial | Ejecutadas | Aprobadas | Fallidas | Omitidas/canceladas | Reintentos | Duración |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Unidades/arquitectura | 134 | 134 | 0 | 0 | 0 | 10.326 s |
| Integración | 30 | 30 | 0 | 0 | 0 | 17.060 s |
| E2E, seis perfiles | 266 | 266 | 0 | 0 | 0 | 13.8 min |
| Multijugador, tres perfiles | 13 | 13 | 0 | 0 | 0 | 1.2 min |
| Total distinto | 443 | 443 | 0 | 0 | 0 | 940.530 s de workflow |

### Regresión final posterior a todas las correcciones

Instalación limpia: 32 paquetes, exit 0, 4.656 s. Build Node 24: exit 0, 3.246 s. Código/fixtures: 3587552; la documentación posterior no cambia la ejecución. `final-native-full.log` y `runs.jsonl` contienen resultados completos. No se aumentaron deadlines ni se cambiaron retries. La matriz de perfiles conserva filtros previos; "omitidos 0" se refiere a tests descubiertos, no a combinaciones que la configuración nunca selecciona.

| Suite final Node 24.21.0 | Ejecutadas | Aprobadas | Fallidas | Omitidas/canceladas | Reintentos | Duración |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Unidades/arquitectura | 154 | 154 | 0 | 0 | 0 | 18.038 s |
| Integración HTTP/WS/procesos | 50 | 50 | 0 | 0 | 0 | 18.979 s |
| E2E local, seis perfiles | 266 | 265 | 1 | 0 | 0 | 14.2 min |
| Multijugador, tres perfiles | 13 | 13 | 0 | 0 | 0 | 1.1 min |
| Total distinto | 483 | 482 | 1 | 0 | 0 | Ver workflows separados abajo |

`npm test` terminó con exit 1 en 897.184 s por el fallo E2E y no alcanzó multijugador. Se ejecutó después `npm run test:multiplayer` completo, exit 0, workflow de 71.700 s, sin otras suites activas. No se informa un workflow completo verde. Durante E2E hubo comprobaciones Node 22 con carga controlada adicional; no se llama aislada a esa matriz de navegador.

El fallo conservado es `alignment.spec.ts:78`, perfil iphone, en `page.reload` (línea 102), timeout de test 30000 ms. La traza sitúa inicio de reload unos 5.36 s después del contexto y el documento tarda 11155.82 ms; JS y CSS posteriores quedan pendientes en la captura. Por tanto no fue simplemente que las interacciones anteriores consumieran casi todo el deadline. Geometría, tokens y selección habían pasado. Traza/contexto/timings/red se conservan en `e2e-failure/`; no se cambió frontend, ese test ni timeout.

Tres repeticiones explícitas del mismo caso, en un worker y sin otras suites, pasaron: 5.6/5.6/5.3 s por caso, 21.9 s de Playwright y 24.274 s de workflow (`e2e-iphone-isolated-repeat.log`). Retries automáticos siguen en cero. El frontend y ese test no cambian respecto del HEAD recibido. La diferencia de carga/ejecución está registrada, pero no prueba causa raíz ni elimina el fallo de la matriz; esas repeticiones no aumentan los 483 casos distintos. No se hizo un cambio especulativo en UI para obtener verde.

Warnings observados: SQLite experimental (especialmente Node mínimo) y mensajes ambientales NO_COLOR/FORCE_COLOR de Playwright. Se revisan errores, skips, cancelados y resultados por escenario; no se interpreta exit 0 solo como prueba de todos los requisitos. Las suites unitarias incluyen arquitectura, SQLite, filesystem, cuotas, syncWork, backup/restore y config; integración incluye HTTP/WS, reinicios, backup/restore real, gates de crash/migraciones y launcher.

### Revisión independiente

Primer revisor: 48 tests dirigidos, 48 aprobados en 11.459 s; confirmó B-03 y refutó daño al archivo hardlinked generado. Segundo revisor: sandbox 152 unidades, 110 pass/42 EPERM fail en 40.042 s; repetición nativa 152/152 en 19.676 s; integración serial 44/44 en 52.166 s. Estas suites corresponden a estados intermedios, no al HEAD final. Sus cinco scripts finales verdes (5.111 s) verifican B-04 a B-07 sobre 4b9d803. Informe separado `post-review-report.md` y logs/probes incluidos en evidencia. Su revisión no sustituye la regresión final del principal.

## G. Node mínimo, estabilidad y entorno destino

El ejecutable oficial Node 22.18.0 fue verificado con SHA256 `c22d1c59a1f767a1ed0178445a027f2257d318c55430fc819d48f269586822b7`. Build ejecutó explícitamente ese binario para TypeScript y Vite (exit 0, 3.567 s), evitando confundir npm bajo Node 24 con herramientas bajo Node 22. Procesos hijos usan process.execPath. Los binarios Node y node_modules no se incluyen en el paquete de evidencia.

| Condición Node 22 | Casos / resultado | Duración de tests | Evidencia |
| --- | --- | --- | --- |
| Baseline inicial con un worker de navegador | Unidades 134/134; integración 30/30 | 16.013 / 25.487 s | baseline-node22-unit/integration.log |
| Tres rondas simultáneas unit+integration+un worker navegador, antes de corregir | Cada ronda 134/134 y 30/30, 0 fail/skip/cancel | Unit: 14.053/13.847/15.527 s; integration: 18.462/18.102/18.768 s | node22-concurrent-{1,2,3}-*.log |
| Post-corrección con otras comprobaciones activas | Unit 152/152; integration 40/44, 4 fail | 26.773 / 27.947 s | node22-final-unit/integration.log |
| Integración serial | 48/48, 0 fail/skip/cancel | 57.464 s | node22-serial-investigation.log |
| Paralela, pequeños probes del revisor pudieron solaparse | 45/48, 3 fail | 38.784 s | node22-parallel-isolated.log |
| Paralela con diagnóstico de startup | 46/48, 2 fail | 37.450 s | node22-startup-diagnostic.log |
| Paralela tras consumir cuerpos 404 | 46/50, 4 fail | 32.678 s | node22-body-drain.log |
| Dos workers, sin otras suites del equipo | 50/50, 0 fail/skip/cancel | 22.254 s | node22-concurrency2.log |
| GET nuevo aislado | 1/1 | 1.132 s total | node22-get-isolated.log |
| TCP/DNS mínimo, 8 procesos por runtime | Node 22 8/8; Node 24 8/8; sin timeout de 8 s | ~0.22–0.25 s por proceso | listen-probe.log |
| Ocho arranques durables Node 22 fuera del runner | 8/8 listos antes de 8 s | 2.09–2.23 s por proceso | node22-durable-startup8.log |
| TCP/HTTP mínimo bajo runner, ocho archivos y un worker de navegador ambiental | Resultado parcial: el primer caso informó timeout de 8 s; el orquestador venció a 30 s, sin resumen completo de los 16 casos registrados | Primer fallo 10.115 s; orquestador 30 s | node22-runner-network.log |
| Repetición predeterminada al reanudar, sin otra suite del equipo | 47/50, 3 fail, 0 skip/cancel | 30.597 s | node22-resumed-default.log |
| Después de npm ci, con un worker de navegador | Unidades 154/154; integración con dos workers 50/50 | 33.578 / 37.455 s | node22-final-clean-unit/integration2.log |

Las ejecuciones fallidas no se cuentan como reintentos automáticos ni se sustituyen por las verdes. Los tres timeouts históricos anteriores a esta misión no se reprodujeron en las primeras rondas, pero la versión corregida y su matriz ampliada sí muestran inestabilidad predeterminada. El cuerpo no consumido era una mejora de fixture y no explicó todos los fallos: después fallaron tests antiguos.

Los fallos cambiaron entre HTTP fetch, Child ready/shutdown, gate de backup, launcher Vite y heartbeat/presencia. En una ejecución el hijo informó imports-ready a 337/401 ms y storage-ready a 407/471 ms, pero nunca listening antes de 8 s; por ello no se atribuye todo a espera SQLite. En la última repetición hubo un hijo sin stdout y un fetch del test durable previo; no es un único stack estable. No se observó EADDRINUSE. Cada prueba usa datos propios/puertos efímeros; el launcher reserva y libera puertos antes de usarlos, lo que no elimina matemáticamente toda carrera de puerto.

La evidencia identifica relación con concurrencia del harness, sin probar la causa exacta (carga/scheduler, runner/runtime, IO, fixture o servidor). Los probes de ocho arranques y TCP refutan un bloqueo inevitable por mera cantidad de procesos. El reproductor mínimo TCP/HTTP bajo el runner también alcanzó timeout sin importar D&D/SQLite, pero su resultado parcial no permite clasificar todos sus casos ni asignar causa. Se comprobó que fork hereda execArgv/entorno y el runner introduce NODE_TEST_CONTEXT=child-v8; el probe comparaba herencia normal/limpia, sin un resultado completo que pueda probar efecto. Esta conducta consta en el [código oficial del runner Node 22.18.0](https://github.com/nodejs/node/blob/v22.18.0/lib/internal/test_runner/runner.js), no es una explicación demostrada del fallo. Tras el timeout se comprobó que no quedaran procesos del directorio exclusivo del probe.

No se midió carga global suficiente para culpar al equipo ni se demostró un bug concreto de Node. No se elevó ningún timeout ni se alteró el script predeterminado para ocultar el problema. Siguiente paso exigido antes de aprobar: capturar retorno de listen, evento/error, retraso del event loop y fetch.error.cause bajo el runner, variar una condición por vez, demostrar causa y corregir o demostrar separación fiable de harness/servidor; repetir luego regresión relevante.

No hubo entorno Linux disponible: WSL no tenía distribución y Docker no estaba instalado. Linux x64 tampoco se ejecutó. Las referencias documentales a Node ARM64 y el código Linux son evidencia de diseño/runtime, no validación del producto. Oracle ARM64 continúa sin probar y no se conectó ni desplegó. Las pruebas Android/iPhone son emulación de navegador, no hardware físico.

## H. Rendimiento y riesgos residuales

Probe pequeño local con mapa sintético de 25 MiB, no una carga pública ni un SLO: preparación/commit/cleanup 466 ms y retraso máximo del timer 456 ms; GET válido 445 ms y RSS 110346240 → 188862464 bytes; backup 771 ms con timer tarde 714 ms; restore 1617 ms con timer tarde 1609 ms; rehidratación de metadata 9.9 ms. Había integración ambiental, por lo que son muestras de ese host, no capacidad del destino. monitorEventLoopDelay no captura por sí solo todos los tramos síncronos; se añadió drift de un timer de 10 ms (`performance-final.json`). El mapa pequeño era 9844 bytes. El PNG grande se generó añadiendo bytes a la fixture válida; no acredita decodificación gráfica completa.

Tras el probe: una sala, un asset metadata, cinco recibos, DB 45056 bytes y WAL 103032. Los GET inválidos tuvieron cero lecturas de asset; el vigente tuvo una. El revisor probó clientes pausados con 2 MiB/8 clientes, 8 MiB/4 clientes y 25 MiB/2 clientes: buffers terminaron liberados/pendingResponses=0; no demostró saturación general, inmunidad a OOM ni un límite total de memoria HTTP. Backup desde CLI usa otro proceso pero retiene writer lock; operaciones pueden recibir BUSY durante la ventana. No se optimizó anticipadamente ni se introdujo framework asíncrono.

| Residual | Severidad | Efecto en aprobación/merge/despliegue |
| --- | --- | --- |
| Node 22 paralelo intermitente sin causa concreta | MEDIA | Bloquea aprobación de B y recomendación de merge. Necesita investigación/corrección y regresión. |
| Timeout E2E iPhone emulado en recarga | MEDIA | Regresión final no totalmente verde; bloquea aprobación. Repetición aislada no basta para probar la causa del fallo de la matriz. |
| Linux ARM64 / VM / energía / red no ejecutados | MEDIA | No demuestra fallo actual en Windows; impide presentar listo para el destino Oracle. Validación aislada antes de desplegar. |
| FS Windows frente a misma cuenta hostil / ACL del operador | ALTA, requisito operacional | No se ha demostrado escape remoto. No desplegar con rutas o cuenta compartida no confiable; Node no ofrece esa frontera absoluta. |
| Pérdida de credencial DM, sin cuenta recuperadora | ALTA, límite de producto previo | Hash/backup no recuperan plaintext. No es una regresión de B ni autorización para implementar cuentas; informar/proteger acceso antes de uso valioso. |
| IO/hash/sync síncronos y snapshot con writer lock | MEDIA | Coste de disponibilidad observado, sin SLO garantizado. Medir en destino antes de uso público. |
| Cuotas no equivalen a volumen físico exacto; lector fijo de WAL / diferentes DB en pool | MEDIA | Reserva/mantenimiento del operador; no aprobación para un volumen sin margen ni multiwriter servidor. No borrado automático de campañas. |
| Promise/JS externo al ámbito o escritura raw | BAJA, interfaz interna | No hay ruta de producción demostrada. No tratar revocación como sandbox de JavaScript arbitrario. |
| PID reutilizado, DB corrupta, restos de restore | MEDIA, operacional | Puede bloquear conservadoramente. Inspección manual, nueva ubicación verificada; no forzar borrados o retirar flags a ciegas. |
| Niebla visual/mapa completo, móvil emulado, sin HTTPS público | BAJA / fuera de alcance | Diseño previo y evidencia limitada. No constituye hardening ni aprobación pública. |

No quedaron fallos críticos o altos **demostrados** de integridad/privacidad/recuperación sin corregir. Los requisitos operacionales altos de esta tabla siguen siendo límites explícitos, no una afirmación de seguridad absoluta ni una excusa para ignorarlos en un despliegue.

## I. Evaluación final

La auditoría confirmó y corrigió crecimiento no acotado, ejecución tardía en contratos internos, lectura costosa para GET rechazados, ventanas de recuperación incompleta y aliases Windows. Conserva la Fase A, los datos sintéticos exactos en pruebas, la autoridad neutral, y el orden de publicación/commit/cleanup sin prometer atomicidad entre medios. La revisión independiente produjo defectos adicionales y refutaciones, no solamente argumentos favorables.

La estabilidad predeterminada de integración en Node 22.18.0 sigue sin causa demostrada; los resultados seriales/dos workers no la resuelven. La regresión final de navegador tuvo además un timeout de recarga y no se presenta como totalmente verde. No se concede aprobación automática ni autorización para Oracle. Los cambios y este informe se publican únicamente en la rama solicitada, tras revisar resultados y diff. La comprobación final de SHA remoto/workspace y el paquete de evidencia están en el informe externo entregado al usuario.

FASE_B_NEEDS_CORRECTION

## Seguimiento fechado — 2026-10-12

[La investigación correctiva B.1](phase-b1-stability.md) documenta la separación externa de la inestabilidad Node22/Windows, una mitigación específica del harness que conserva concurrencia de clientes, los controles de navegación iPhone y la regresión completa posterior de 484/484. Incluye resultados negativos, limitaciones causales, un error de adquisición de trazas y revisión independiente con probe propio. Su veredicto de seguimiento es FASE_B_APPROVED en las condiciones documentadas. El veredicto histórico FASE_B_NEEDS_CORRECTION y los resultados de esta auditoría B permanecen intactos; no se declara retroactivamente que sus pruebas fallidas pasaron ni se autoriza merge/despliegue.

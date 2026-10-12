# Fase B.1 — Investigación de estabilidad

Fecha de cierre: 2026-10-12. Seguimiento de B-08 y B-12. Regresión completa **484/484** y revisión independiente favorables. Este informe conserva los resultados negativos de [la auditoría B](phase-b-audit.md); no repite ni cambia su conclusión histórica. Los problemas se cierran mediante evidencia de origen externo y una ejecución controlada fiable, conservando las incertidumbres causales expresadas abajo.

## A. Estado inicial y Git

- Repositorio: `https://github.com/Farimuz/D-D`.
- Rama: `feat/v0.0.5-portable-persistence`.
- HEAD inicial local/remoto: `a1313714af7162fca58a58c9896694f31359632f`; workspace inicialmente limpio.
- `origin/main` y merge-base: `78e4b4fdc9d4ce7b0c73e121c53d06ee6f78612c`.
- Fetch inicial correcto; consulta de PR abierto por head devolvió cero.
- HEAD de código validado: `36b7e09679796548f322c4e8f27cbb8a44411c27`; dos commits de código descritos en D y un commit documental de cierre.
- Publicación por push normal en la misma rama. El SHA final documental, HEAD local/remoto y workspace limpio se registran en `publication.json` y en el informe entregado, después de crear ese commit. No rebase, PR, merge, tag/release ni despliegue.

Se leyeron completos los siete documentos exigidos y los archivos/fixtures relevantes. Se consultaron las trazas originales disponibles. Los experimentos usaron loopback, datos sintéticos y directorios propios; no tocaron campañas/backups reales, Oracle ni configuración global del sistema.

Entorno: Windows 11 Home Single Language x64 `10.0.26300`, Intel i5-10300H, cuatro núcleos/ocho procesadores lógicos, 24 GiB de RAM. Runtime instalado Node `24.21.0`, npm `11.19.0`, TypeScript `7.0.2`, Vite `8.1.5`, Playwright `1.63.0`. Node mínimo `22.18.0`, binario portátil oficial verificado contra SHASUMS, SHA-256 `c22d1c59a1f767a1ed0178445a027f2257d318c55430fc819d48f269586822b7`. No instalación global de runtime adicional. `initial-state.json` conserva la medición inicial.

## B. Investigación Node 22 / B-08

### Diseño y línea base

Cada escenario de integración se ejecutó secuencialmente, sin otra suite del agente. La concurrencia predeterminada de Node usa `availableParallelism() - 1`; aquí permite siete procesos de archivo, según [la documentación exacta de Node22.18.0](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--test-concurrency). Dentro de cada test siguen siendo posibles solicitudes y conexiones concurrentes. No había `NODE_OPTIONS`, `NODE_TEST_CONTEXT` ni `UV_THREADPOOL_SIZE` establecidos en el padre. Los hijos del runner sí reciben su contexto interno; se compararon alternativas de herencia separadamente.

| Escenario inicial, sin modificaciones B.1 | Ejecutados/aprobados | Fallidos/cancelados/omitidos | Duración runner |
|---|---:|---:|---:|
| A: Node22, serial | 50/50 | 0/0/0 | 39.023 s |
| B: Node22, dos procesos | 50/50 | 0/0/0 | 23.502 s |
| C: Node22, predeterminada | 50/50 | 0/0/0 | 19.865 s |
| C2: repetición predeterminada | 50/50 | 0/0/0 | 20.428 s |
| C3: repetición predeterminada | 50/50 | 0/0/0 | 19.779 s |
| D: Node24, predeterminada | 50/50 | 0/0/0 | 18.158 s |
| D2: repetición predeterminada | 50/50 | 0/0/0 | 18.431 s |

Las tres ejecuciones Node22 predeterminadas favorables no borran los 47/50 y 46/50 históricos. El host llegó al 100% de CPU tanto en escenarios correctos como en problemáticos; las matrices conservaron al menos aproximadamente 7 GiB de RAM libre. No se acepta saturación de CPU o falta de RAM como causa demostrada por esos datos.

### Reproductor externo al producto

Ocho archivos mínimos crean un servidor HTTP/TCP en puerto efímero, consumen cuatro respuestas, crean un proceso hijo del mismo runtime, esperan su listening, consumen cuatro respuestas adicionales y cierran ambos. No importan D&D, SQLite, assets ni sus fixtures. Deadlines de etapa 8 s, test 20 s y cleanup 2 s. La guarda externa posterior de 30 s termina exclusivamente el árbol propio y marca resultado negativo/parcial; no aumenta los límites de tests del producto.

| Variante mínima | Aprobadas | Fallidas | Canceladas | Observación |
|---|---:|---:|---:|---|
| Node22 predeterminada inicial | 1 | 3 | 4 | 21.303 s |
| Node24, mismo código/configuración | 8 | 0 | 0 | 1.739 s |
| Node22, quitar solo contexto del hijo | 1 | 5 | 2 | No resuelve |
| Node22, quitar solo execArgv del hijo | 4 | 4 | 0 | No resuelve |
| Node22, usar http.get en vez de fetch | 4 | 4 | 0 | No exclusivo de Undici |
| Node22, copia idéntica, aislada | 1 | 7 | 0 | Nombre/ruta no resuelven |
| Node22, original, confirmación aislada | 2 | 6 | 0 | 11.766 s |
| Node22, logger de etapas en memoria | 2 | 6 | 0 | No depende de append por etapa |
| Node22, serial | 8 | 0 | 0 | 3.851 s |
| Node22, dos procesos, r1/r2/r3 | 8/8/8 | 0/0/0 | 0/0/0 | 2.284/2.293/2.245 s |
| Sin node:test ni runner, Node22 | 3 | 5 | 0 | Siete padres máximo, ocho escenarios |
| Sin node:test ni runner, Node24 | 8 | 0 | 0 | Mismo código, 2.886 s |

La variante con timer referenciado no cerró correctamente y se terminó su árbol propio tras inspección. Una primera comparación de copia se solapó con ese proceso superviviente; no es una comparación aislada. Se conservan ambas y la repetición aislada. `experiment-caveats.md` identifica las erratas de aislamiento de los summaries automáticos, incluidas las ondas deliberadamente simultáneas con navegador. No se sobrescriben datos brutos.

Una segunda instrumentación tomó el stopwatch **después** de escribir la marca previa, y calculó la duración antes del siguiente log. Midió llamadas síncronas a `fetch` de 30.018/30.130/30.114 s y a `fork` de 30.101 s, frente a escrituras de log previas de 0.44–0.49 ms. Esa ejecución fue terminada por la guarda y es parcial, no ocho tests aprobados. El logger en memoria reprodujo fallos sin escrituras por etapa.

**Mecanismo demostrado:** algunos procesos del runtime Node22.18.0 en este host Windows se detienen durante invocaciones de red/creación de procesos, antes de poder atender timers o completar readiness. La misma familia de fallos ocurre sin aplicación, sin SQLite y sin runner. El probe independiente también reproduce espera HTTP sin un span síncrono largo: no se afirma que todos los timeouts compartan un único stack no observado. Por ello no se atribuye a una transacción SQLite, carrera de sala, puerto fijo ni exclusivamente a `node --test`. La separación no identifica la función nativa de Windows, un proveedor de sockets, un parche específico de libuv ni un defecto general de todas las instalaciones Node22. No se inventa esa atribución.

### Mitigación y concurrencia del servidor

`test:integration` pasa por un launcher que limita a dos procesos de archivo **solo Windows + Node22.18.0**, la combinación reproducida. Node24 y otras plataformas/versiones conservan la concurrencia predeterminada. Puede investigarse la configuración original directamente con `node --test tests/integration/*.test.ts`. No cambian timeouts ni retries. La mitigación requiere ejecución secuencial de suites; no promete comportamiento bajo carga simultánea arbitraria.

Tres probes propios con un único servidor durable Node22 y clientes Node24 hicieron ocho health requests concurrentes, ocho joins de jugadores, ocho comandos pendientes simultáneamente sobre un socket DM, subida de mapa y ocho descargas byte-exactas. Todos conservaron revisión 9, ocho fichas y exclusión de la credencial plaintext del DM; cierre 38/39/43 ms, retraso máximo del event loop 105–115 ms y RSS de aproximadamente 78 MiB. Son controles Windows con datos sintéticos, no ocho jugadores/escritores SQLite mutando simultáneamente, pruebas físicas móviles ni validación cloud. La privacidad de hashes y asociaciones permanece cubierta por las pruebas anteriores, no solo por este check plaintext.

Se añade una prueba de integración con esas operaciones concurrentes contra un único servidor/store durable del runtime que ejecuta la suite. Comprueba revisiones persistidas, ocho IDs distintos, recepción por los jugadores y bytes del mapa. Así el límite de procesos entre archivos no serializa los clientes dentro del servidor ni elimina las pruebas anteriores de conflictos/reinicio/backup.

## C. Investigación iPhone / B-12

La traza histórica conserva reload iniciado a 5.36 s y recursos JS/CSS pendientes. El HAR reporta `time=11155.816 ms` para el documento, pero la revisión cruzada encontró `dns=5509 ms`, `connect≈55 ms` y `ssl≈5564 ms` incluso en HTTP. La suma del generador HAR instalado cuenta `dns + connect + ssl + wait + receive`: aquí el campo ssl repite aproximadamente dns+connect. Las marcas monotónicas/documento→solicitud JS y sus startedDateTime dan **5598.202 ms**. Por ello 11.16 s se conserva como valor HAR, no como elapsed de reloj confirmado. La demora material y el timeout de 30 s siguen confirmados en el registro histórico. Las comprobaciones previas de geometría, selección y guardado pasaron. No hay instrumentación suficiente del backend/host para asignar retrospectivamente una función exacta responsable.

El backend E2E predeterminado real es **Node sirviendo `dist`**, no Vite. `DND_TEST_DEV=1` selecciona el launcher de desarrollo, pero no estuvo activado en esta matriz. La lectura de mapas de IndexedDB ocurre después de ejecutar JS; no explica por sí sola recursos JS/CSS que no terminan. No se modificó lógica de alineación ni carga de mapas.

La instrumentación de navegación es opt-in `DND_NAVIGATION_DIAGNOSTICS=1`, limitada a alignment: tipos de recursos, estado HTTP, marcas monotónicas, documento/navegación, DOMContentLoaded, load, inicio/retorno reload y comprobación de aplicación restaurada. Conserva pending resources y errores de red sanitizados; no URLs, headers, contenido de consola, credenciales ni estado de partida. Los asserts de consola existentes siguen comprobando ausencia de errores. Los eventos se adjuntan a resultados; las trazas detalladas se usaron solo en experimentos dirigidos. Un preload temporal externo midió listening, request/finish, readFile JS/CSS/HTML, RSS y retraso de event loop del backend.

| Condición aislada, un worker browser y ninguna suite/probe Node22 simultánea | Resultado | Duración |
|---|---:|---:|
| Caso iPhone, tres repeticiones explícitas | 3/3 | 8.2/7.5/7.1 s; workflow 36.023 s |
| Archivo alignment iPhone completo | 8/8 | workflow 79.510 s |
| Perfil iPhone completo | 47/47 | workflow 264.682 s |
| Segunda serie instrumentada aislada del caso | 3/3 | workflow 22.648 s; reload 109/86/81 ms |
| Última serie aislada sobre código final, después de npm test completo | 3/3 | 5.8/5.6/5.6 s por caso; workflow 23.433 s |

Se mantuvo `page.reload()` esperando **load**, timeout 30 s, todas las comprobaciones funcionales y retries cero. Después de reload se compara estado exacto y mapa visible. Los filtros históricos de perfiles permanecen intactos.

### Interferencia controlada y límites de la atribución

Al iniciar una onda mínima Node22 predeterminada al comienzo de cada caso, las navegaciones iniciales iPhone tardaron 20.25/10.17/10.17 s frente a unos 100 ms aisladas. El servidor Node24 registró retraso de event loop máximo 7.34 s; tras recibir solicitudes, readFile/response terminaron normalmente en milisegundos. Las ondas mínimas dieron 1/8 (dos cancelaciones), 2/8 y 2/8; el navegador dio 3/3. Esto demuestra interferencia externa sobre navegación del producto, no un defecto de alineación ni reproducción exacta del timeout histórico de reload.

Al activar ondas en el evento Reload, las recargas terminaron antes de inicializarse la carga. Son controles de sincronización insuficientes para atribuir la recarga histórica. Una onda Node22/two con navegador dio 6/8: refuta estabilidad arbitraria con dos workers si no se aíslan las suites. Las tres ondas Node24 dieron 8/8.

Un segundo servidor mínimo, HTML/JS/CSS y WebKit iPhone sin D&D/SQLite, conservó readiness explícito y recarga load. Con Node22 predeterminada se observaron fallos de las ondas y una navegación inicial de 20.128 s en la tercera ronda **antes de iniciar su propia onda**, después de terminar la onda anterior; las recargas de conexiones calientes fueron rápidas (224–460 ms). Se trata de arrastre/interferencia externa, no una prueba de carga activa de esa ronda. Los controles Node22/two y Node24 fueron correctos. Cerrar las conexiones idle del servidor mínimo antes de la carga tampoco reprodujo el timeout: recargas Node22 253/303/292 ms, Node22/two 177/187/189 ms, Node24 332/360/555 ms, todas con readiness. Las ondas Node22 predeterminadas siguieron siendo negativas; los controles dos workers/Node24, favorables. Esta evidencia negativa refuta que cerrar conexiones idle baste para reproducir B-12.

La serie final conserva tres trazas completas y JSON de navegación: reload 114.363/78.651/87.691 ms, aplicación restaurada comprobada a 280.356/252.945/221.030 ms desde su inicio, cero recursos pendientes, cero errores de red y ningún log truncado. Cada caso solicita dos documentos, dos scripts y dos estilos (primera navegación + reload), además de las imágenes locales. El test comprueba estado guardado exacto, mapa visible y consola limpia. Se copiaron solo después del cierre completo.

**Límite:** el timeout histórico exacto no se presenta como reproducido ni se asigna con certeza retrospectiva a Windows, Node, WebKit o Vite. Sí hay evidencia directa de demoras de navegación equivalentes en orden de magnitud fuera de la lógica de juego y de interferencia entre procesos. La inferencia convergente de origen externo, matriz completa, repeticiones dirigidas, controles independientes y conservación del requisito original justifican el cierre operativo de B-12 conforme al criterio admitido en la misión. La causa retrospectiva exacta sigue abierta; no se declara corregido un defecto de frontend que no fue demostrado.

## D. Cambios y alcance

1. Launcher de integración con límite específico a Windows/22.18.0 y propagación de código de salida/señales.
2. Prueba durable de ocho clientes/acciones concurrentes que aumenta integración de 50 a 51 casos.
3. Diagnóstico opt-in de navegación de alignment, sin modificar sincronización ni expectativas.
4. Este informe y referencia fechada en auditoría B.

| Commit de código verificado | Cambio |
|---|---|
| `e815a447680ea5824a176ab910b4a36a0c2fb15c` | Launcher específico Windows/22.18.0 y regresión durable de ocho clientes/comandos |
| `36b7e09679796548f322c4e8f27cbb8a44411c27` | Diagnóstico de navegación opt-in, conservando reload/load y comprobaciones originales |

Estos commits contienen las mismas fuentes ejecutadas en las repeticiones previas y en la regresión completa; crearlos no cambió código. El commit documental de cierre se identifica en la entrega y en el historial de la rama.

No cambian código del producto, core, protocolo, esquema/migraciones, autoridad DM/jugador, operaciones de backup/restore, dependencias ni lockfile. Los probes de investigación y resultados negativos se conservan en el archivo de evidencia entregado, con manifiesto SHA-256. No se amplía la auditoría de almacenamiento.

## E. Regresión final

La primera ejecución posterior a instalación limpia se interrumpió controladamente después de 109 resultados E2E: 99 favorables, **10 fallidos por `browserContext.close: EBUSY`** (nueve Edge, uno Firefox). El principal había añadido un lector de artefactos que abría las trazas activas de Playwright; se retiró ese proceso propio y se preservaron los diez error-context, logs y archivos disponibles antes del segundo intento. El mecanismo de interferencia de adquisición está sustentado por el diseño del lector y la cronología, sin capturar qué llamada exacta de copia mantuvo cada lock. Esta ejecución es negativa/incompleta, no una matriz aprobada; multijugador no llegó a ejecutarse. Sus 154 unidades y 51 integraciones finalizaron antes del lector. Las trazas copiadas en escritura y las del test activo al aborto pueden ser parciales. La repetición usa instalación limpia y no lee `test-results` hasta terminar todos los procesos. `contaminated-regression-summary.json`, `artifact-reader-stop.json`, `contaminated-run-abort.json` y `experiment-caveats.md` conservan procedencia y límites. No se modificaron timeouts, expectativas o producto para sortear el fallo.

La repetición R2 completó instalación limpia (`npm ci`: 32 paquetes, exit 0, 3.162 s), build (exit 0, 2.574 s) y `npm test` entero (exit 0, **903.044 s**). Las fuentes de código son las de los dos commits de D; la documentación posterior no cambia ejecución. No había probes, otras suites del agente ni lectores de trazas activos. Solo se leyeron logs stdout del orquestador. El aislamiento corresponde a trabajos del agente, no a garantizar ausencia de toda actividad de Windows.

| Suite R2 | Ejecutados | Aprobados | Fallidos | Omitidos | Cancelados | Reintentos | Duración |
|---|---:|---:|---:|---:|---:|---:|---|
| Unitarios y arquitectura | 154 | 154 | 0 | 0 | 0 | 0 | 20.890 s runner |
| Integración Node24 | 51 | 51 | 0 | 0 | 0 | 0 | 20.248 s runner |
| Local E2E | 266 | 266 | 0 | 0 | 0 | 0 | 13.1 min, redondeo informado por Playwright |
| Multijugador | 13 | 13 | 0 | 0 | 0 | 0 | 1.1 min, redondeo informado por Playwright |
| **Total distinto** | **484** | **484** | **0** | **0** | **0** | **0** | npm test 903.044 s, incluye hooks/builds/arranque |

Los perfiles locales conservan sus filtros históricos: Chrome/Edge/Firefox/WebKit 42 cada uno, Android 51 e iPhone 47. La prueba de recarga iPhone afectada pasó dentro de la matriz (5.4 s de caso). Sus ocho casos alignment y 47 de perfil se ejecutaron todos sobre el código final. Omitidos cero se refiere a casos descubiertos; no significa que cada combinación excluida por los filtros haya sido seleccionada. No se cuentan las repeticiones como nuevos casos distintos.

| Integración Node22, launcher final | Ejecutados/aprobados por repetición | Fallidos/cancelados/omitidos/reintentos | Duración runner |
|---|---:|---:|---|
| Primera serie aislada 1/2/3 | 51/51 cada una | 0/0/0/0 | 25.115 / 24.614 / 24.590 s |
| Serie R2 aislada 1/2/3 | 51/51 cada una | 0/0/0/0 | 25.116 / 24.889 / 24.694 s |

Son seis ejecuciones favorables, no una sola repetición. Integración pasa completa y conserva SQLite, transacciones/commits inciertos, acceso privado, mapas/rutas, backup/restore, migraciones, reinicios/terminación abrupta y lifecycle. Los tests unitarios conservan auditoría transitiva del core y MemoryRoomStore. El aumento legítimo es 50→51 integración y 483→484 total. No hay reducción de casos/aserciones; sí se declara la limitación de procesos de archivo en la combinación Windows/22.18.0.

Se revisaron resultados, cantidades y warnings. Node22 informa el aviso de SQLite experimental; Playwright informa conflicto NO_COLOR/FORCE_COLOR en procesos del harness. Las comprobaciones de consola de alignment pasaron y no hay casos omitidos; no se afirma un censo independiente de todas las consolas de páginas de otros tests. Build y código de salida son correctos. Los logs completos y `final-results.jsonl` conservan también la ejecución inicial interrumpida. Las 350 ejecuciones iniciales y 482/483 de B no sustituyen esta regresión. En la repetición R2 y las series finales, los artefactos se copiaron solamente después de cerrar sus procesos; esto no se atribuye al lector erróneo de la primera ejecución. Multijugador usa `test-results/multiplayer` y conserva el root local: la copia posterior al workflow contiene los **45 JSON de alignment**, incluidos ocho iPhone y reload iPhone de **77.468 ms** en la matriz (`full-matrix-artifact-summary.json`). Se corrige expresamente la suposición preliminar de que multijugador borraba E2E. No hay trazas completas de cada test aprobado porque la configuración original solo las retiene en fallos; sí se conservan los diagnósticos opt-in y resultados completos.

El censo nativo final (`final-cleanup.json`, 2026-10-12T11:58:31Z), después de todas las suites y diagnósticos, encontró **cero procesos Node propios coincidentes y cero listeners en el puerto E2E 4173**. La comprobación complementaria de ambos puertos (`final-cleanup-all-suite-ports.json`, 12:14:13Z) confirmó cero procesos coincidentes y cero listeners en **4173 y 4183**, incluyendo multijugador. No se deduce de ello ausencia absoluta de actividad del host. No se detectó pérdida de datos en las pruebas; los datos utilizados son sintéticos.

## F. Revisión independiente

Revisor nuevo, contexto separado, sin implementación; comparte host/checkout. Reconstruyó causas desde fuentes y datos negativos y creó `independent-minimum.mjs`, sin importar D&D, SQLite, node:test ni los probes del principal. Ocho padres/casos HTTP con Connection: close, seis respuestas de sí mismo y seis del hijo: Node22/siete padres 3/8 (cinco TimeoutError self-fetch), Node22/dos padres 8/8 (2.334 s), Node24/siete padres 8/8 (1.700 s). No hubo guarda forzada; censo CIM propio posterior cero procesos. El primer intento en sandbox dio ocho EACCES y se conserva como limitación del sandbox, no reproducción del timing. El mayor span síncrono propio fue 194 ms: no se exagera como reproducción de la pausa de 30 s.

El revisor identificó las etiquetas automáticas de aislamiento incorrectas, la doble suma HAR, el arrastre anterior a la onda propia, la activación tardía de carga en reload y la precisión de la prueba concurrente (un socket DM, no ocho escritores SQLite). El principal corrigió el seguimiento y mantuvo datos brutos. Analizó los diez errores EBUSY, la repetición sin lector y confirmó desde datos crudos 154+51+266+13 favorables, sin marcas de fallos, skips, retries o flaky. Verificó el censo final y los tres JSON finales de reload con cero recursos pendientes. Recomienda **FASE_B_APPROVED**; no encontró condición causal material adicional que impida el cierre según la misión. Su independencia es de contexto/fuente de probe/análisis, no de máquina ni auditoría ciega de infraestructura. `independent-b1-review.md` conserva alcance, resultados negativos y límites.

## G. Riesgos residuales

| Gravedad | Riesgo / límite | Consecuencia |
|---|---|---|
| MEDIA | Capa nativa exacta del bloqueo Node22/Windows no identificada; dos workers no garantizan estabilidad con otras suites simultáneas | Ejecutar suites secuencialmente; evidencia no permite prometer estabilidad absoluta o bajo carga arbitraria |
| MEDIA, mitigada operativamente | Causa retrospectiva exacta de B-12 no disponible en traza histórica | Conservar incertidumbre y diagnósticos; los controles externos y regresión completa sustentan el cierre B.1, no estabilidad absoluta |
| OBSERVACIÓN | Solo Windows x64 ejecutado; no Linux/ARM64 ni Oracle | No afirmar portabilidad operativa ni despliegue aprobados |
| OBSERVACIÓN | SIGKILL/procesos sintéticos previos no demuestran resistencia a cortes físicos | Conserva limitaciones de auditoría B |

No hay un nuevo defecto crítico/alto demostrado sin corregir en esta pasada; esto no equivale a seguridad absoluta. Las pruebas esenciales de persistencia y arquitectura siguen pasando. Los riesgos medios de precisión causal no impiden la aprobación de B.1 bajo las condiciones controladas demostradas. Un merge sigue requiriendo su decisión/revisión propia; el despliegue público/Oracle requiere autorización y validación del entorno objetivo, incluidas las limitaciones de la auditoría B. Esta tarea no autoriza ninguno de esos pasos.

## H. Veredicto

No se demostró un defecto de producto que justificara modificar servidor, frontend, persistencia o core. Se demostró una familia de fallos externa en HTTP/fork concurrentes sobre el runtime/host probado, se aplicó una limitación de procesos de archivos sustentada sin serializar los clientes del servidor y se preservó el requisito de reload/load. La matriz completa y múltiples repeticiones pasan; los controles del revisor coinciden y no quedan procesos propios huérfanos observados. Los resultados negativos, el error de adquisición y los límites de causalidad permanecen documentados. Se cumplen los criterios de cierre admitidos en la misión, sin prometer seguridad/estabilidad absoluta ni validar Linux ARM64 o despliegue.

FASE_B_APPROVED

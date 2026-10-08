# D&D

Proyecto para crear una herramienta propia que facilite organizar y jugar partidas de Dungeons & Dragons a distancia.

La idea es construir una experiencia sencilla de usar tanto en PC como en teléfono, especialmente pensada para reducir el trabajo del Dungeon Master.

**v0.0.5 — Núcleo portable y persistencia Node (fases A + B)** conserva la mesa local y las salas multijugador de v0.0.4. El DM comparte un enlace o código y los jugadores mueven sus fichas asignadas. SQLite conserva salas y accesos privados; el filesystem conserva los mapas. Reiniciar el servidor con las mismas rutas recupera esos datos. La fase A está aprobada; la fase B está implementada y pendiente de auditoría independiente. No hay cuentas. El paquete conserva la versión 0.0.4 hasta una publicación de versión posterior.

## Ejecutar

Requiere Node.js 22.18 o posterior y npm. Desde la raíz del repositorio:

```sh
npm ci
npm run dev
```

Este comando inicia Vite y el backend juntos (puerto 8787). El frontend usa un proxy HTTP/WebSocket del mismo origen. Abre la dirección que muestra Vite. Para probar en un teléfono en la misma red, usa la dirección `Network` del PC; el firewall debe permitir el puerto de desarrollo.

El servidor usa modo durable por defecto: `.dnd-data/rooms.sqlite` y `.dnd-data/assets/`, excluidos de Git. Reutiliza ambos para recuperar una partida. Para sesiones temporales, usa `npm start -- --temporary` o configura `DND_STORAGE_MODE=temporary` antes de `npm run dev`. Las rutas y la operación de backup/restauración se describen en [persistencia de fase B](docs/architecture/phase-b-persistence.md).

Crea fichas con **＋ Ficha**, arrástralas para moverlas y arrastra el fondo para desplazar la vista. Selecciona una ficha para cambiar su **Nombre**, **Duplicar** o eliminarla. Usa la rueda del ratón o dos dedos para hacer zoom anclado al cursor o al punto medio; dos dedos también desplazan la vista. Los botones **− / ＋** ajustan el zoom y **⌖** centra la ficha seleccionada o vuelve al origen. Se puede alejar por debajo del 50%; el máximo sigue siendo 250%. La selección se conserva al navegar, medir y ajustar mapas; **Escape** o **×** la retiran. Si añades un segundo dedo al arrastrar una ficha, su movimiento pendiente se cancela antes de navegar.

Pulsa **Mapa** y elige una imagen local PNG, JPG/JPEG o WebP (máximo **25 MiB y 32 millones de píxeles**, para limitar memoria en teléfonos; SVG no se admite). En **Ajustar mapa**, arrastra la imagen y cambia la escala con **− / ＋** o el porcentaje hasta alinear sus casillas con la cuadrícula de **64 px**; pulsa **Listo** para volver a mover fichas. **Mapa** permite ajustar, reemplazar o eliminar la imagen sin borrar fichas; **Ver mapa completo** encuadra la imagen con un margen. A zoom muy alejado las fichas se dibujan pequeñas, conservando un área táctil de 44 px cuando es posible.

Si la imagen tiene cuadrícula, usa **Ajustar mapa → Alinear cuadrícula → Marcar una casilla**. Marca dos esquinas diagonalmente opuestas de una misma casilla, en cualquier orden. Acércate con rueda, dos dedos o **＋**; arrastra el fondo para navegar. Ajusta los puntos arrastrando sus cruces (también con flechas: 0.25 px; Mayús + flechas: 1 px). Verás el tamaño detectado, la escala y la cuadrícula propuesta encima del mapa. **Aplicar** guarda escala y posición juntas; **Reintentar** borra los puntos; **Cancelar** o **Escape** conserva exactamente la configuración anterior y la ficha seleccionada. Durante el asistente las demás herramientas están bloqueadas y su zoom de inspección es independiente del zoom de la mesa.

**Sé el tamaño** pide columnas y filas, y dos esquinas opuestas de la cuadrícula útil completa: excluye márgenes y usa intersecciones como referencia. Ambos métodos calculan escala uniforme mediante `64 / √(ancho × alto)` de la casilla original; aceptan una diferencia entre ejes de hasta el **6 %** respecto a su media y ajustan el primer punto a la intersección más cercana de la mesa. No corrigen rotación ni perspectiva. Por ejemplo, una casilla de 16 × 16 px produce 400 %.

Activa **Medir** y arrastra entre casillas con mouse o un dedo. La distancia entre sus centros es `5 × √(Δx² + Δy²)` pies, con diferencias en casillas y una decimal cuando hace falta; no aplica reglas especiales de diagonales. La medición es temporal y **Listo** la retira. Siempre **1 casilla = 5 pies**.

En modo local, fichas, cámara, zoom y referencia/posición/escala del mapa se guardan en `localStorage`; la imagen se guarda como **Blob en IndexedDB** (bytes binarios si el navegador no puede almacenar Blob), sin Base64 ni subidas en modo local. Los datos de v0.0.1 siguen siendo compatibles. En modo local, todo pertenece al navegador y dirección usados, sin compartirse entre dispositivos; borrar sus datos elimina la mesa. Si no puede guardarse una importación, se avisa y se conserva el mapa anterior. **Limpiar**, con confirmación, restablece la mesa y borra sus imágenes almacenadas; eliminar fichas o mapa también requiere confirmación.

## Partidas online

Abre **☰ → Crear partida online**. La sala empieza con tus fichas, mapa y niebla actuales; la mesa local se conserva. Comparte el **Enlace para jugadores** o el código. En otro navegador, abre el enlace y escribe únicamente un **Nombre**; también puedes entrar con código desde **☰**. El enlace nunca incluye la credencial privada del DM.

El DM ve los participantes conectados/desconectados en **☰**. Selecciona una ficha y elige **Controlada por → jugador**. Ese jugador puede moverla; el servidor rechaza movimientos de fichas ajenas y todas las demás ediciones. El DM puede editar y mover cualquier ficha. Los jugadores nunca reciben fichas Solo DM ni fichas cuyo centro esté cubierto por niebla. Cámara, zoom, selección, paneles y mediciones son independientes. Los movimientos se confirman al soltar; gana el último cambio válido aceptado por el servidor.

La identidad del jugador y el acceso privado del DM se guardan en ese navegador y dirección. Recargar o reconectar recupera el participante y sus asignaciones mientras exista la sala. **Conectado / Reconectando… / Desconectado** indica el estado; no se acumulan ediciones offline para reenviarlas. Volver a **Mesa local** recupera tus datos locales.

En modo durable, reiniciar Node conserva salas, asignaciones, niebla, revisión, accesos y mapas; las conexiones empiezan de cero. Treinta minutos sin conexiones liberan memoria y permiten recuperar después la sala almacenada. Hay un máximo de diez salas activas y diez jugadores por sala, 200 fichas y 1000 regiones de niebla. En modo temporal, reiniciar sí elimina las salas y la inactividad conserva la caducidad anterior. El mapa se transmite como binario por HTTP, con los mismos límites de 25 MiB y 32 millones de píxeles. El mapa completo llega al jugador: **la niebla es protección visual, no una frontera anti-trampas**. No expongas esta versión experimental a una red no confiable como si fuera un servicio endurecido.

Para probar con un teléfono, abre la URL **Network** de Vite en la misma Wi-Fi y crea la sala usando esa dirección también en el PC; así el enlace compartido incluye la IP del PC. La prueba emulada de iPhone no sustituye Safari en un dispositivo físico. Consulta [arquitectura, protocolo y límites](docs/multiplayer.md).

## Herramientas del DM

Activa **Niebla → Ocultar** y arrastra un rectángulo con mouse o un dedo. La preview se guarda únicamente al soltar; una interrupción o un segundo dedo cancela el dibujo. **Revelar** resta el rectángulo seleccionado de todas las regiones cubiertas. **Ocultar todo** cubre los límites completos del mapa colocado; sin mapa cubre la vista y las fichas usadas con margen. **Mostrar todo** elimina la niebla. Usa **Navegar** para arrastrar la cámara y los controles habituales, la rueda o dos dedos para el zoom; **Listo** termina la herramienta.

En una ficha seleccionada, desactiva **Visible para jugadores** para marcarla **Solo DM**: el DM sigue viéndola con borde discontinuo e indicador DM. Las fichas antiguas y nuevas son públicas por defecto.

**Vista jugadores** proyecta la misma mesa con niebla opaca y sin herramientas de edición. Las fichas Solo DM y las fichas cuyo **centro de casilla** está dentro de algún rectángulo de niebla se excluyen completas, aunque una parte de su círculo quede fuera; el borde izquierdo/superior pertenece al rectángulo, el derecho/inferior no. Puedes navegar y hacer zoom, pero ningún cambio de esta preview se guarda. **Volver a DM** recupera la cámara y selección anteriores; recargar siempre inicia en DM. La medición está disponible solo para el DM.

En modo local, la niebla y la visibilidad se guardan junto a la mesa en `localStorage`; el mapa continúa en IndexedDB. Los datos de v0.0.1/v0.0.2 conservan su esquema y se interpretan sin reescribirlos al cargar: visibilidad ausente significa pública y niebla ausente significa vacía. La niebla queda anclada al mundo: coloca y alinea el mapa antes de dibujarla; mover o reemplazar después la imagen no mueve ni borra los rectángulos.

Esta preview **no es una frontera de seguridad**: los datos completos siguen en el navegador local. No comparte una partida ni protege secretos frente a alguien con acceso a ese navegador. El revelado geométrico puede fragmentar regiones después de muchas operaciones; no hay pinceles, visión automática ni iluminación dinámica.

## Build y servidor

```sh
npm run build
npm run preview
```

El build genera el frontend en `dist/`; el servidor Node sirve esos archivos, las rutas `/room/...`, HTTP de mapas y WebSocket. `npm run preview` escucha en 4173; `npm start` usa 8787. Ambos usan las mismas rutas durables por defecto; ejecuta un único servidor por base SQLite. `npm run dev` reinicia el frontend automáticamente; tras editar el backend, reinicia el comando completo.

Un backup manual incluye una instantánea consistente de SQLite y sus mapas referenciados. El comando imprime la carpeta creada:

```sh
npm run storage -- backup
npm run storage -- restore --backup ".dnd-backups/<copia>" --target ".dnd-data/restore-01"
npm start -- --data-dir ".dnd-data/restore-01"
```

Sustituye `<copia>` por la carpeta impresa. El destino de restauración debe ser nuevo y su padre debe existir. Consulta [configuración, recuperación y límites](docs/architecture/phase-b-persistence.md) antes de operar sobre datos durables.

## Pruebas

```sh
npx playwright install chromium firefox webkit
npm test
```

Las pruebas requieren Chrome y Edge instalados en Windows y verifican también Firefox, WebKit y vistas móviles. Incluyen dos contactos táctiles nativos emulados en Pixel 5/Chromium y dos Pointer Events sintéticos en iPhone 13/WebKit, cuya automatización no permite inyectar pinch nativo ni rueda móvil. La emulación no reemplaza una prueba física en Android o Safari/iOS.

La fixture de [cuadrícula conocida](tests/fixtures/README.md) verifica alineación de casillas de 16 px y exclusión de márgenes. Las pruebas cubren escala, posición, ajuste fino, preview sin guardar, cancelación, reintento, fallo de almacenamiento y conservación de la selección.

Las pruebas de v0.0.3 añaden validación y sustracción de rectángulos, coordenadas negativas, datos antiguos, visibilidad de fichas, persistencia, cancelación de niebla y navegación de jugadores sin cambios guardados. Los escenarios de niebla se ejercitan con mouse y touch en los perfiles móviles indicados; también se revisan los controles en 320 × 568, 390 × 844 y 844 × 390.

La suite completa mantiene las pruebas locales y añade unidades de permisos/proyección, integración con HTTP y WebSocket reales y tres perfiles multijugador: DM Chrome con dos jugadores, usando Chrome, Pixel 5 o iPhone 13/WebKit para uno de ellos. Verifica mapas binarios, permisos, cámara independiente, niebla, identidad y reconexión. Puedes ejecutar por separado `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` y `npm run test:multiplayer`.

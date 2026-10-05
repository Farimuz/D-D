# Salas multijugador v0.0.4

## Arquitectura

React reutiliza la misma mesa para local, DM online y jugador. Local mantiene localStorage/IndexedDB; online usa una proyección recibida del único estado canónico de la sala y una cámara/zoom separados en el cliente. No guarda una copia completa alternativa de la partida. Servidor Node/TypeScript sin framework, HTTP nativo y [ws](https://github.com/websockets/ws). Las salas, participantes y bytes de mapas viven en memoria.

Archivos: src/online/protocol.ts define contratos y validadores; desde v0.0.5-A src/core/room aplica permisos/proyección y server/rooms.ts coordina estado y acceso; server/app.ts gestiona HTTP, WebSocket y heartbeat; src/online/useRoom.ts mantiene conexión y vista; src/online/session.ts guarda acceso local y transfiere mapas. scripts/dev.mjs inicia ambos procesos y los detiene juntos. Desarrollo usa /api y /socket mediante el proxy Vite, conservando Host y Origin. Véanse la [arquitectura vigente](architecture/portable-runtime.md) y la [auditoría de fase A](architecture/phase-a-audit.md).

## HTTP y mapas

POST /api/rooms recibe {version:1,tokens,map:null,fog}; devuelve {roomId,credential}. El servidor reemplaza IDs locales y elimina asignaciones antiguas. La credencial aleatoria del DM tiene 256 bits; solo se almacena su hash en el servidor. La respuesta y mensajes sensibles no se registran.

PUT /api/rooms/CODE/map exige Authorization: Bearer CREDENCIAL, cuerpo binario y X-Map-Layout con {x,y,width,height,scale}. Comprueba firma PNG/JPEG/WebP, dimensiones mediante [image-size](https://codeberg.org/image-size/image-size), tamaño, geometría y permisos. Admite dimensiones invertidas por orientación EXIF. Es un lector de cabeceras, no un decodificador completo: el frontend valida la imagen decodificada y avisa si otro navegador no puede abrirla. Una subida fallida/interrumpida conserva los bytes y metadatos anteriores. Solo se permite una subida simultánea por sala; al aceptar ambos se sustituyen juntos.

GET /api/rooms/CODE/map/UUID devuelve la imagen binaria con tipo correcto, no-store y nosniff. La sala comparte únicamente su URL y geometría por WebSocket, nunca Base64. El mapa completo es accesible a quien conozca la sala; la niebla no oculta sus bytes. Borrar/reemplazar mapa invalida la URL anterior. Reiniciar el servidor lo pierde.

## WebSocket y autoridad

/socket exige mismo origen cuando Origin está presente. El primer mensaje JSON es join con roomId y role. DM añade credential; jugador añade identity aleatoria de 64 caracteres hexadecimales y name. El servidor liga el rol y participante a esa conexión; ninguna acción acepta campos de autoridad.

Después: {type:'action',requestId,action}. Acciones DM: token.create, token.update, token.delete, fog.set, map.update, map.delete y board.reset. Un jugador solo puede enviar token.update con el par x/y entero para una ficha pública visible asignada a él. El servidor comprueba cada vez la asignación y niebla actuales, incluso después de revocaciones y durante conflictos. map.update debe conservar ID y dimensiones del mapa vigente. Nombres rechazan HTML y caracteres de control; campos extra, formas inválidas y coordenadas no finitas/fuera de rango se rechazan. No hay eval ni inserción HTML de nombres.

Respuesta: result con requestId, ok y tokenId opcional para creaciones, o mensaje de rechazo. Cada cambio aceptado incrementa revision y difunde state: roomId, role, selfId, board, participants, dmConnected. El DM recibe el estado completo y nombres/presencia; jugadores reciben fichas filtradas y ningún secreto, hash ni identidad de acceso. Las fichas Solo DM o con centro de casilla cubierto por niebla nunca se incluyen. Las regiones sí se envían para dibujar la cobertura opaca. El estado compartido no tiene cámara, zoom, selección, panel, drag ni medición.

El movimiento se envía al soltar y solo queda confirmado al recibir el estado aceptado. Gana la última actualización válida en orden de recepción del servidor; no hay bloqueo de fichas. Los cambios son parches de campos, por lo que renombrar no sobrescribe una posición concurrente. El cliente mantiene como máximo 32 solicitudes pendientes, espera confirmación durante ocho segundos y no reenvía automáticamente acciones sin confirmar.

## Reconexión y límites

Identidad de jugador aleatoria de 256 bits en localStorage; el servidor guarda su hash y un ID de participante propio. El mismo navegador/origen recupera participante y asignaciones al recargar. La credencial DM se guarda por sala, nunca en el enlace. Son mecanismos básicos, sin cuentas ni recuperación entre dispositivos. Compartir o borrar almacenamiento puede compartir o perder autoridad. Si el navegador impide guardarlo, se avisa.

Reconexión automática con espera de 0.5 a 5 segundos; handshake de siete segundos. El servidor cierra conexiones sin join a los cinco segundos y verifica ping/pong cada 30 segundos. Se conserva la sala al desconectar al DM y nunca se promueve al jugador. Salas inexistentes o acceso rechazado muestran Desconectado y explicación. Durante pérdida de conexión se puede navegar, pero se bloquean ediciones; cambios no confirmados generan aviso.

Límites: 10 salas, 10 identidades de jugador por sala (incluye desconectados para conservar asignaciones), cuatro conexiones por identidad o DM, 512 sockets globales, 200 fichas, 1000 regiones, JSON entrante de 256 KiB, mapa de 25 MiB y 32 millones de píxeles. Coordenadas de ficha enteras entre -1 000 000 y 1 000 000; nombres de hasta 60 caracteres. Las salas sin participantes ni DM conectados y sin subida activa caducan tras 30 minutos. No hay base de datos ni campañas permanentes.

## Verificación y prueba manual

npm test ejecuta unidades, integración real HTTP/ws, compatibilidad local completa y matriz multijugador. Las pruebas cubren DM+A+B, movimientos propios/ajenos, proyección, sincronización, reconexión, mensajes manipulados, tamaños excesivos, subida abortada y heartbeat. Android usa contactos CDP emulados; iPhone/WebKit usa Pointer Events sintéticos para gestos que su automatización no inyecta de forma nativa. Esto no acredita uso físico en Safari/iOS.

1. npm install y npm run dev en el PC.
2. Abre la URL de Vite y pulsa ☰ → Crear partida online.
3. Copia el enlace a otro navegador o ventana privada, escribe un nombre y entra; repite para otro jugador.
4. Crea una ficha en DM, asígnala, muévela desde su jugador; el otro solo puede navegar. Comprueba mapa, niebla y Solo DM.
5. Recarga jugador y DM: deben recuperar acceso; cámara y zoom de cada uno siguen independientes.
6. Para teléfono en la misma Wi-Fi usa la URL Network del PC también para crear la sala, comparte ese enlace y permite el puerto de Vite en el firewall. HTTP local no cifra credenciales; un despliegue fuera de la LAN requiere HTTPS/WSS y protección del servicio.

No se incluyen cuentas, chat, combate, base de datos, múltiples escenas ni anti-cheat de mapas.

# D&D — Propuesta de experiencia del jugador y del DM

**Estado:** dirección de UI/UX **aprobada provisionalmente** en conversación, octubre de 2026. No está implementada ni validada en hardware real. Este documento describe comportamiento y objetivos, no píxeles definitivos ni arte generado.

## Principios del producto

- La **mesa y la aventura** ocupan el centro de la atención. Las herramientas frecuentes deben ser rápidas; las avanzadas, accesibles sin estorbar.
- PC y teléfono deben permitir participar en la misma sesión sin exigir al DM que realice cada acción ordinaria del jugador.
- Reutilizar **un solo tablero**, con proyecciones y controles diferenciados por rol; no crear aplicaciones de tablero divergentes.
- Controles legibles, superficies táctiles adecuadas, navegación por teclado donde proceda y estados claros de carga, error y reconexión.
- No comprometer permisos o privacidad por razones estéticas: los secretos se filtran en el servidor.

## Pantalla del jugador mientras juega

### PC

- **Mapa protagonista**: referencia conceptual de aproximadamente 70–75 % del espacio de contenido horizontal; no es una medida rígida.
- **Panel lateral contextual**: personaje, combate/iniciativa y funciones secundarias. Puede plegarse para ampliar el mapa.
- Barra de herramientas del tablero con mover, medir y opciones permitidas.
- Estado de conexión y acceso persistente al **lanzador global de dados**.
- Exploración y combate son contextos de la **misma interfaz**: en combate destacan ronda, turno, iniciativa y recursos.

### Teléfono

- Mapa siempre recuperable y ampliable; **bandeja inferior desplegable** para hoja, combate y utilidades, evitando forzar el mapa en una miniatura permanente.
- Resumen corto de nombre, HP y CA accesible rápidamente.
- Abrir/cerrar/minimizar panel sin perder cámara, zoom ni selección del mapa.
- Evitar gestos invisibles como única forma de interactuar; contemplar orientación vertical/horizontal.
- El concepto anterior en conversación mostraba paneles apilados; **el comportamiento táctil final requiere prototipo real** para evitar tapar fichas o robar gestos del tablero.

### Dados

- El lanzador universal es **independiente de la hoja de personaje** y se abre desde la mesa.
- Permite comenzar vacío, añadir d4/d6/d8/d10/d12/d20/d100 en cantidades, modificador entero, y editar directamente la fórmula; los controles deben sincronizarse cuando sea válida.
- Tiradas preconfiguradas en armas, habilidades o hechizos abren el **mismo** lanzador con su fórmula, editable para una ejecución sin sobrescribir el preset.
- Resultado generado/autenticado por servidor, visible en historial según política por definir; no calcular en la animación del cliente.

### HP y recursos

- No depender de pulsar +1 o −1 repetidamente. Permitir ingresar **cantidad** para daño o curación.
- Separar HP máximo, actual y temporal; definir claramente qué cambió. Los recursos de uso frecuente tendrán controles rápidos.
- Los cambios confirmados se guardan y durante sesión activa producen notificación discreta al DM cuando sean relevantes.
- Cambiar estadísticas estructurales requiere una acción de edición contextual, no exponer siempre decenas de campos.

## Hoja completa y biblioteca de personajes

- Menú principal equilibrado: «Mis personajes» y «Mis campañas», incluso sin una campaña existente.
- Biblioteca con fichas de personajes; borradores incompletos que se guardan automáticamente y estado «Listo» que controla el jugador sin validación obligatoria.
- **Edición híbrida adaptable**: durante preparación prioriza captura y edición; durante juego prioriza lectura y acciones rápidas. No se implementan dos hojas independientes.
- Pestañas sugeridas: **Resumen**, Inventario/Equipo, Habilidades, Hechizos, Notas. El resumen siempre existe; las otras pueden ocultarse por personaje sin borrar información, y volver a activarse.
- Resumen con nombre/clase/nivel, HP, CA, seis características, estadísticas útiles de combate y acciones frecuentes. No introducir un generador automático de clases 2014/2024 en esta etapa.

## Pantalla del Dungeon Master

- **Mismo tablero** que los jugadores. Panel de dirección en PC; bandeja contextual en móvil.
- Contexto **Escena**: mapa, fichas, ajustes y niebla; contexto **Combate**: enemigos, HP, iniciativa, turno y ronda; contexto **Notas**: notas privadas del DM y compartidas.
- **Vista jugadores**: permitir inspeccionar la proyección para comprobar lo visible, sin modificar el estado al previsualizar.
- Datos privados del DM, secretos de criaturas y notas privadas deben quedar fuera del payload del jugador. La niebla existente es **protección visual**, no impide leer los píxeles del mapa completo; evitar poner secretos de alta sensibilidad directamente en imágenes descargables.
- No crear al inicio un constructor visual avanzado de encuentros, monstruos o iluminación dinámica.

## Estados y mensajes

Mostrar claramente: conectado, reconectando, desconectado, acción pendiente, acción confirmada, error no confirmado (que **no equivale** a rechazo definitivo). Evitar autointentar operaciones mutables cuando el commit es incierto. Para dados, usar idempotencia durable antes de automatizar reintentos.

## Validaciones UX antes de declarar interfaz terminada

1. Jugador en teléfono abre hoja y regresa al mapa sin perder la posición ni provocar arrastres accidentales.
2. Durante combate, acceso rápido a dados y HP sin navegar por varios menús.
3. DM oculta un enemigo, activa previsualización y confirma que los jugadores no lo reciben.
4. Dos personas en pantallas diferentes usan la misma mesa sin inconsistencias visibles.
5. Navegación táctil, teclado, foco, contraste y botones cómodos; revisar orientación, ancho reducido y textos largos.
6. La aplicación no informa éxito ni descarta una acción cuando el servidor no ha confirmado su persistencia.
7. El jugador puede personalizar pestañas, desocultarlas y conservar sus datos.

## Abierto, no decidir por apariencia

- Densidad final del panel lateral y tamaño del panel móvil.
- Presentación y filtros del historial de tiradas.
- Flujo preciso para cambiar de personaje en campaña activa.
- Tipos de tiradas privadas y permisos de lectura de hojas de otros personajes.

**Alcance de PR 0:** únicamente especificación documental. Los prototipos de conversación eran demostraciones no conectadas con el repositorio. Véanse [estado](../PROJECT_STATUS.md) y [plan técnico](../IMPLEMENTATION_PLAN.md).
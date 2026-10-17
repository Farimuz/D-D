# D&D — Estado vigente y continuidad del proyecto

> **Actualizado:** 2026-10-17  
> **Repositorio:** Farimuz/D-D  
> **Base verificada:** main, commit d5ce9bbd8e72ed823ca0b764960b020d783fdf70 (PR #7 documental; implementación v0.0.5 integrada mediante PR #6).  
> **Hito técnico integrado:** v0.0.5 (PR #6, merge b1e6c3c). El paquete y el distintivo de UI aún indican 0.0.4; no se ha publicado un release nuevo.  
> **Situación de producto:** infraestructura de mesa remota y persistencia implementada; herramientas de personajes, dados, lobby y combate **no implementadas**.  
> **Alcance de este documento:** continuidad y acuerdos de diseño; NO autoriza desarrollo, cambio de versión, merge ni despliegue.

## 0. Cómo retomar D&D desde otra conversación o herramienta

1. Leer este documento para reconstruir el estado funcional, los acuerdos y las incógnitas.
2. Contrastar con el HEAD actual de main: este documento representa el estado verificado en la fecha indicada y podría quedar desactualizado.
3. Leer [documentación principal](../README.md), [índice de documentación](README.md), [visión de producto (decisión 0002)](decisions/0002-complete-accessible-extensible-game-system.md), [arquitectura portable (decisión 0003)](decisions/0003-portable-core-infrastructure-adapters.md) y [auditoría v0.0.5](architecture/v0.0.5-final-audit.md) cuando el trabajo lo requiera.
4. Distinguir siempre **implementado y verificado**, **acordado pero pendiente** y **propuesto o por decidir**. No convertir en requisitos definitivos las alternativas exploradas.
5. Antes de implementar, discutir alcance, contratos, migraciones, pruebas y efectos sobre funciones existentes. No modificar otros proyectos ni desplegar sin autorización explícita.

## 1. Objetivo de producto

D&D busca facilitar partidas remotas de Dungeons & Dragons con amigos desde PC y teléfono, especialmente si están aprendiendo a jugar. Debe reducir la dependencia de papel, chats y herramientas externas para las funciones esenciales, sin hacer que el DM tenga que ejecutar cada acción ordinaria de los jugadores.

El foco inicial es una mesa estable, cómoda y utilizable con **un DM principal** y, previsiblemente, **una campaña activa**. No se pretende replicar íntegramente Nivel20, D&D Beyond o un creador automático de personajes. Nivel20 se ha utilizado como inspiración para la separación entre menú/campañas/personajes y la comodidad de los dados; no como especificación literal.

A largo plazo: reglas de quinta edición más automatizadas, hechizos/efectos, contenido casero, opciones avanzadas y posible reutilización de personajes entre campañas. Aún no se eligió entre D&D 5e 2014 y 2024; el modelo inicial debe evitar depender prematuramente de una de ellas.

## 2. Realmente implementado en main (v0.0.5)

- Mesa local en navegador y salas online con DM/jugadores. Acceso a sala por código/enlace, identidades de navegador y credencial privada del DM. No hay cuentas.
- Tablero con fichas movibles/asignables, visibilidad, niebla de guerra, zoom/gestos táctiles y medición.
- Mapas externos importables, alineación de cuadrícula y ajustes de escala/posición. Generación de mapas propia expresamente no prioritaria (decisión 0001).
- Core portable con contratos y validaciones independientes de los adaptadores de infraestructura: ver src/core/room/, server/rooms.ts y src/online/protocol.ts.
- Node como backend HTTP/WebSocket con permisos aplicados por el servidor; el jugador solo puede mover fichas públicas asignadas. Hay proyecciones por rol.
- Persistencia durable Node: SQLite para estado de salas y accesos; filesystem para imágenes; recuperación entre reinicios, backups/restauración y pruebas de fallos/transacciones. Modo temporal en memoria disponible.
- El estado de la sala aún contiene esencialmente tablero, participantes y revisión (src/core/room/types.ts). Las fichas no son personajes: src/state/model.ts define nombre/posición/visibilidad/propietario.
- Los requestId existentes correlacionan solicitudes y respuestas; **no proporcionan todavía idempotencia durable de tiradas**. Ante pérdida de conexión no se reenvían automáticamente los cambios inciertos.

**Verificación histórica:** la auditoría de v0.0.5 registra 488/488 tests aprobados en Windows, incluyendo pruebas multijugador y persistencia. **No se han vuelto a ejecutar con motivo de este documento**. Node/Linux/ARM64/Oracle y exposición pública segura no quedaron validados. La versión de paquete sigue siendo 0.0.4 pese a que el código de v0.0.5 se fusionó.

**Estado operacional:** no consta un despliegue activo de D&D en Oracle ni una URL pública/privada entregada. Oracle es una opción futura; la instancia conocida también aloja trabajo de otro proyecto (Hermes): no tocarla ni asumir recursos disponibles sin autorización y comprobaciones aisladas.

## 3. Acuerdos de dirección técnica (aún no implementados)

### 3.1 Un modo principal servido por Node

Las nuevas funcionalidades de jugadores, personajes, dados, combate y persistencia se diseñarán sobre el **modo con servidor**. El servidor podrá ejecutarse localmente en el PC para desarrollo y pruebas, y más adelante en Oracle/u otro host. La mesa local tradicional conserva su funcionalidad existente: **no es requisito dar paridad inmediata** de las nuevas funciones en modo navegador sin servidor.

Objetivo: una sola autoridad sobre estado, permisos, aleatoriedad y guardado. No reimplementar dos motores completos de juego.

### 3.2 Entrada, identidad, lobby y campañas

**Decisiones aprobadas, todavía sin implementar:**

- Registro **solo por invitación administrativa** de un uso, caducable y revocable. Cuenta con usuario y contraseña, sin correo obligatorio ni login social. Recuperación mediante código temporal de un solo uso emitido por el administrador (inicialmente también DM), sin consultar contraseña previa.
- **Cuenta independiente de campañas.** El jugador puede registrarse y preparar personajes aunque todavía no haya campaña ni DM conectado, siempre que el servidor esté activo.
- Las invitaciones de **registro** y de **campaña** son separadas. El menú principal tendrá dos secciones equivalentes: «Mis personajes» y «Mis campañas».
- Biblioteca personal con **varios personajes** y borradores incompletos con guardado automático. El jugador marca manualmente «Listo» o «En preparación», de modo reversible e informativo, sin campos obligatorios ni bloquear ediciones.
- Al recibir una invitación de campaña, el jugador la acepta y **elige libremente** su personaje activo, sin aprobación formal del DM. El DM puede ver la elección y conserva control de reglas y mundo.
- Primera etapa: un DM principal, una campaña activa y **un personaje activo por jugador/campaña**. Cambiar personaje durante una campaña activa y reutilizar simultáneamente el mismo personaje entre campañas se posponen.
- Separar **cuenta, personaje, participación en campaña, ficha/token, campaña, sesión y encuentro**. Los HP viven en una sola fuente de verdad; borrar una ficha no borra un personaje.
- No reclamar ni transferir permisos de salas históricas de manera automática al crear cuentas; preservar compatibilidad con salas por código y credencial de navegador.

La motivación y los límites se documentan en [decisión 0004](decisions/0004-cuentas-invitaciones-personajes.md).

### 3.3 Hojas digitales y progresión manual

Primera etapa: hojas introducidas y editadas **manualmente** a partir de personajes creados por medios externos; no creador completo con clases/reglas automáticas. La creación acepta borradores incompletos con autoguardado; el estado de preparación lo marca el jugador y no impide editar. La hoja debe bastar para consultar la información ordinaria durante la partida.

**Datos centrales deseados:** nombre, raza/especie, clase, nivel, HP máximo/actual/temporal (son tres valores distintos), clase de armadura, seis características (FUE, DES, CON, INT, SAB, CAR), estadísticas de combate, inventario/objetos/cantidades, armas, armaduras y equipo.

**Convenientes por utilidad durante sesiones, sujetos a precisión de campos:** trasfondo, subclase, velocidad, iniciativa, salvaciones, competencias/habilidades, monedas, ataques/daño, hechizos, espacios de hechizo, recursos con contadores, dados de golpe y notas.

**Habilidades:** al inicio registros manuales separados con al menos nombre y descripción, como bloc de notas, sin ejecutar efectos automáticamente. Preparar una estructura razonable para incorporar luego efectos/recursos sin construir hoy el motor de reglas.

**Continuidad:** cambios aceptados a HP, nivel, objetos, recursos y demás datos sobreviven a cerrar la sesión, reiniciar el servidor y cambiar de mapa. Evitar duplicados contradictorios del mismo HP entre hoja y combate.

### 3.4 Dados: universales, libres y autoritativos

Dos accesos al **mismo motor de dados**:

1. **Lanzador universal global, fuera del menú de personaje y vacío por defecto:** el jugador elige cantidad y tipos de dados (p. ej., 1d20 + 2d4), bonificación entera positiva/negativa y lanza. En la parte inferior hay una **fórmula editable** que también permite empezar escribiendo desde cero. Controles y expresión deben mantenerse sincronizados en ambos sentidos cuando la fórmula sea válida. Mostrar error sin borrar una fórmula parcial/inválida.
2. **Tiradas preconfiguradas:** cada arma/habilidad/hechizo puede tener inicialmente **una configuración guardada** para su tirada habitual, reutilizando el lanzador universal. El jugador puede ajustar la tirada actual sin sobrescribir la configuración guardada.

**Acuerdo de simplicidad:** modificadores y dados adicionales circunstanciales se aplican **solo a una tirada**, sin efectos persistentes automáticos. No implementar inicialmente macros complejas, todas las reglas especiales o animaciones 3D. Una futura animación 3D sería representacional, no generaría el resultado.

**Autoridad e idempotencia:** cliente construye/solicita, servidor valida límites y expresión, genera resultados y confirma/almacena resultado. Una solicitud repetida con el **mismo identificador lógico** debe recuperar el resultado original, nunca lanzar de nuevo. No confundir requestId para correlación actual con deduplicación transaccional persistente. Reutilizar ID con contenido diferente debe rechazarse. El historial ha de mostrar dados individuales, modificadores y total; visibilidad pública/privada queda por definir.

No aplicar automáticamente daño, consumo de recursos o alteraciones de enemigos solo por haber tirado dados.

### 3.5 Combate, control y notificaciones

- Primer combate **manual asistido**, no simulador exhaustivo de reglas.
- HP de personaje modificable tanto por su jugador como por DM. Si lo edita el jugador durante sesión en curso, generar **aviso discreto al DM** y registro con autor y cambio. No exigir aprobación por defecto.
- Cada jugador puede editar **su propia hoja**. Fuera de sesión, edición sin alertas al DM; durante sesión, alertas sobre cambios relevantes. No permitir modificar hojas de otros jugadores.
- **HP de enemigos solo modificable por DM** mientras no exista un motor fiable que resuelva daños, resistencias, vulnerabilidades y otros efectos. Tirar un ataque/daño no modifica por sí mismo HP del enemigo.
- Iniciativa, rondas/turnos, condiciones y recursos manuales, con sincronización y control por permisos; el DM arbitra las reglas no automatizadas.
- Preparación vs sesión en curso es la distinción conceptual para avisos. No vincular «sesión activa» a que el proceso servidor esté encendido o el DM tenga socket abierto.
- Los secretos del DM y las hojas/acciones privadas deben filtrarse en la **proyección del servidor**; esconder elementos con CSS no ofrece privacidad.

### 3.6 Persistencia y continuidad narrativa

- Guardado duradero de cambios confirmados **automático**, no dependiente de un único botón «Guardar partida».
- Al pausar y continuar días después deben conservarse personajes, HP, experiencia/nivel, inventarios, recursos, mapa, fichas y progreso conocido por el sistema.
- Notas manuales breves para acontecimientos narrativos, asuntos pendientes y resumen de la sesión. Distinguir notas privadas del DM y compartidas; no intentar deducir automáticamente toda la historia.
- Pausar/terminar una sesión **no debe eliminar progreso** ni reiniciar por defecto recursos y HP.
- Backups/recuperación deben extenderse con pruebas cuando aparezcan nuevas entidades.

### 3.7 UX de la mesa aprobada provisionalmente

- **Jugador en PC:** tablero protagonista con panel lateral para resumen de personaje, combate y herramientas; en teléfono, tablero accesible con bandeja/panel inferior adaptable. Exploración y combate comparten interfaz.
- **DM:** mismo tablero con controles contextuales de escena, mapas/niebla, criaturas, turnos, notas y previsualización de jugador; no desarrollar dos motores.
- **Dados:** lanzador universal accesible globalmente; tiradas guardadas del personaje abren el mismo lanzador.
- **Hoja híbrida:** «Resumen» siempre visible; pestañas opcionales de inventario, habilidades, hechizos y notas, ocultables por personaje sin borrar datos. Acciones frecuentes de HP y recursos rápidas; edición estructural por sección; preparación de personaje facilita introducir datos.
- **HP:** operación de daño o curación por cantidad arbitraria, con HP temporal distinto del actual y máximo.
- **Validación pendiente:** prototipos visuales aprobados como dirección, **no programados** ni validados en dispositivos reales. Probar bandeja móvil, interacción táctil, densidad del panel, log y accesibilidad.

Véase [especificación de experiencia](design/PLAYER_DM_UX.md).

## 4. Lo que se pospone expresamente

- Generador de mapas propio (usar imágenes externas).
- Creador automático completo de personajes, progresión de clases y reglas de 2014/2024 específicas.
- Motor de hechizos, resistencias/vulnerabilidades y resolución integral de efectos.
- Creador avanzado de armas, monstruos y contenido casero, aunque el diseño futuro no debe bloquearlo.
- Reutilización activa de la misma hoja entre campañas y sincronización de progreso entre campañas.
- Dados 3D, bonificaciones persistentes automáticas y un lenguaje de macros.
- Funciones de streaming, transmisión o vista especializada de espectadores.
- Plataforma social, múltiples DM, perfiles complejos y administración avanzada de campañas.
- Paridad funcional inmediata con modo local en navegador.

## 5. Decisiones abiertas — no fijar unilateralmente

1. **Identidad y recuperación:** modelo de cuentas mínimo, credenciales seguras, cambio de dispositivo, extravío y revocación.
2. **Modelo campaña/sesión/sala:** relación con RoomState existente, pausas, invitaciones, permisos y posible archivo de campañas terminadas.
3. **Hoja v1:** campos exactos, controles en móvil, opcionales para personajes sin magia, representación de hechizos/competencias/recursos y límites de contenido.
4. **Expresiones de dados:** gramática exacta inicial, límites y errores, ventaja/desventaja, tiradas privadas y retención de resultados.
5. **Avisos y actividad:** qué cambios de hoja notifican al DM y cómo evitar saturación o filtrar secretos.
6. **Persistencia:** migración con versionado y compatibilidad de esquemas estrictos, transacciones y deduplicación durable; sin pedir al usuario borrar datos existentes.
7. **Producto:** distribución exacta por releases/PR y criterio de «primera sesión jugable», aún no aprobados como roadmap inmutable.
8. **Despliegue:** pruebas reales Node/Linux/Oracle ARM64, HTTPS/WSS, autenticación y protección de rutas, backups y aislamiento de otros servicios. No publicar ni tocar Hermes sin autorización.
9. **Reglas:** 2014 vs 2024 y grado de automatización futura, sin fijar prematuramente.

## 6. Riesgos y contratos que importan

| Riesgo | Precaución de diseño |
|---|---|
| Romper salas existentes al agregar hojas | Migraciones versionadas y pruebas con datos/backups anteriores |
| Perder o secuestrar personajes | Identidad/recuperación seguras y autorización desde servidor |
| Duplicar tiradas al reconectar | Idempotencia durable, payload verificado y resultado original recuperable |
| Filtrar secretos | Proyecciones por rol y autorización por operación; no protección cosmética |
| Contradicción de HP entre hoja y combate | Una fuente de verdad por dato, referencias estables |
| Sobrecarga del DM por alertas | Eventos discretos, filtrables, durante sesión, sin aprobar cada acción |
| UX móvil difícil | Prototipos y pruebas táctiles con información progresiva |
| Sobrearquitectura | Primitivas simples, datos editables, automatizar solo lo útil |
| Acoplar todo a Oracle o Cloudflare | Mantener core portable y adaptadores separados |
| Despliegue inseguro o interferencia con Hermes | Validar aisladamente y requerir autorización expresa |

## 7. Posible secuencia de trabajo — propuesta, NO roadmap aprobado

A. Definir identidad mínima, relaciones jugador/personaje/campaña y migraciones.
B. Construir flujo vertical de lobby sencillo + hoja manual persistente + reconexión/recuperación.
C. Motor único de dados en servidor, lanzador visual/formulado, tiradas guardadas, log e idempotencia.
D. HP, recursos, iniciativa, turnos, condiciones y avisos al DM sobre el modelo compartido.
E. Validación integral: entrar, preparar, jugar, guardar automáticamente, desconectar, reiniciar, retomar y comprobar permisos/privacidad desde PC y teléfono.

La UI puede crecer incrementalmente durante estos pasos; no esperar a implementar todo el backend para probar la comodidad. No dar por hecha la denominación v0.0.6 ni comprometer fechas sin revisar el alcance.

## 8. Criterios para evaluar próximas decisiones

- ¿Permite jugar una sesión básica sin volver continuamente al papel o a otras herramientas?
- ¿Los jugadores pueden hacer sus acciones habituales desde su dispositivo sin exigir aprobación del DM para todo?
- ¿La partida se puede retomar fielmente después de varios días y un reinicio?
- ¿Es sencillo usarlo en teléfono y computadora?
- ¿Los permisos, los secretos y los resultados de dados son realmente validados por el servidor?
- ¿Podremos ampliar reglas, contenido casero y automatizaciones sin rehacer el sistema?
- ¿Estamos construyendo algo necesario para jugar o complicando el proyecto antes de tiempo?

**Nota de actualización:** este documento registra acuerdos actuales, pero no reemplaza las decisiones históricas aceptadas ni las evidencias técnicas. Cuando cambien las decisiones, registrar motivo y fecha; cuando cambie el código, actualizar aquí qué quedó efectivamente implementado.

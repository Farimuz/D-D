# 0004 — Cuentas por invitación y selección libre de personaje

- **Fecha de acuerdo:** octubre de 2026 (consolidado el 2026-10-17).
- **Estado:** aceptada como decisión de producto; **pendiente de implementación**.
- **Ámbito:** modo servidor Node, no mesa local heredada.

## Contexto

Una identidad temporal vinculada al navegador sirve para las salas existentes, pero no basta para recuperar hojas entre dispositivos, preparar personajes sin campaña ni sostener una progresión persistente. El grupo inicial es pequeño; no se busca una plataforma social.

## Decisión

1. **Registro por invitación administrativa**: cada código se usa una sola vez, caduca y puede revocarse. Cuenta simple de usuario/contraseña, sin correo obligatorio.
2. **Acceso recuperable**: sesiones persistentes sujetas a revocación. El administrador (inicialmente el DM) puede facilitar un código de recuperación temporal de un solo uso. Nunca ve contraseñas antiguas.
3. **Cuenta independiente de campañas**: registro y biblioteca de personajes funcionan aunque el DM no esté conectado, siempre que el servidor esté disponible.
4. **Invitaciones independientes**: la invitación para crear cuenta no incorpora automáticamente al usuario a ninguna campaña; el DM envía una invitación distinta para participar.
5. **Selección libre**: el jugador acepta una invitación de campaña y selecciona su personaje sin aprobación formal del DM. El DM ve la elección y sigue arbitrando las reglas.
6. **Biblioteca con borradores**: varios personajes por cuenta, autoguardado, edición manual y estado «Listo» / «En preparación» marcado por el propio jugador, reversible e informativo; no se necesitan campos completos para guardar o seleccionar.
7. **Restricción inicial**: un personaje activo por jugador en cada campaña; inicialmente un DM y una campaña activa. Un personaje, una participación y una ficha en el tablero tienen identidades distintas.

## Consecuencias

- Es preciso definir entidades y relaciones persistentes separadas para cuenta, personaje, participación, campaña, ficha y sesión.
- Los HP y otros datos de personaje deben tener una fuente de verdad; eliminar fichas no elimina personajes.
- El backend comprueba propiedad, roles y permisos en cada acción. La UI no sustituye autorización.
- Las salas heredadas no deben convertirse automáticamente en campañas de una cuenta ni perder su acceso. Cualquier vinculación requerirá una migración o flujo explícito con pruebas.
- Implementación de seguridad pendiente: hash apropiado de contraseña, cookies/sesiones, protección CSRF cuando corresponda, rate limiting, auditoría administrativa, expiración y revocación de invitaciones/códigos. No se registran secretos en texto plano.

## Alternativas descartadas para esta etapa

- Registro libre o cuentas de terceros como requisito.
- Correo electrónico obligatorio.
- Aprobación formal del DM de cada personaje seleccionado.
- Asignación exclusiva de personajes por parte del DM.
- Forzar hojas completas o validaciones rígidas 5e 2014/2024 antes de guardar.
- Biblioteca de personajes inseparable de una campaña.

## Queda pendiente

- Cambio de personaje mientras se está jugando o después de iniciar una campaña.
- Recuperación del acceso de administrador si también pierde sus propias credenciales.
- Reutilización simultánea de un personaje en varias campañas, multijugador de varios personajes activos y campañas simultáneas.
- Detalle técnico de esquemas, endpoints, permisos de lectura de hojas ajenas y transacciones.

## Motivos para revisitar la decisión

Una necesidad real del grupo que requiera flujos de aprobación, mayores roles o varias campañas simultáneas, o evidencia de que el esquema de seguridad elegido no puede proteger adecuadamente las cuentas.

**Esta decisión no crea cuentas ni modifica el código.**
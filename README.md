# D&D

Herramienta web experimental enfocada en facilitar partidas remotas de Dungeons & Dragons desde PC y dispositivos móviles.

**v0.0.1 es una mesa local experimental.** Una cuadrícula, fichas con nombre y controles para mover la vista. No hay cuentas, servidor de aplicación ni multijugador.

## Ejecutar

Requiere Node.js 22.18 o posterior y npm. Desde esta carpeta:

```sh
npm install
npm run dev
```

Abre la dirección que muestra Vite. Para probar en un teléfono conectado a la misma red, abre la dirección `Network` de tu PC; el firewall debe permitir el puerto de desarrollo.

```sh
npm run build
npm run preview
```

La construcción de producción queda en `dist/` y puede servirse como archivos estáticos. La aplicación no necesita backend ni instalación en el dispositivo.

## Usar la mesa

- **＋ Ficha** pide el nombre y coloca la ficha cerca del centro visible.
- Arrastra la ficha con mouse o un dedo; se ajusta a la casilla al soltar. Arrastra el fondo para desplazar la vista.
- **− / ＋** ajustan el zoom entre 50% y 250%. **⌖** centra la ficha seleccionada, o vuelve al origen si no hay selección, y restablece el zoom al 100%.
- Selecciona una ficha para ver su nombre y eliminarla con confirmación. **Limpiar** también solicita confirmación.
- Con teclado: Tab para enfocar, flechas para mover la ficha o la cámara, Escape para cancelar/deseleccionar y Supr para eliminar con confirmación.

Fichas, posiciones, cámara y zoom se guardan automáticamente en `localStorage` al terminar cada cambio. El guardado pertenece al navegador y a la dirección usada: no se comparte entre dispositivos, perfiles o puertos. Si el navegador impide guardar, se muestra un aviso. Un gesto cancelado vuelve a su posición anterior.

## Código y pruebas

`src/components/` contiene la interfaz y los gestos; `src/map/` las coordenadas y el snap; `src/state/` el modelo, la validación y el almacenamiento. React y React DOM son las únicas dependencias de ejecución; Vite, TypeScript y Playwright se usan para desarrollar y probar.

```sh
npx playwright install chromium firefox webkit
npm test
npm run build
```

Las pruebas incluyen Chrome y Edge instalados en Windows, Firefox, WebKit, vista iPhone y Android emulado con gestos táctiles. La emulación no reemplaza una prueba física en Safari/iOS o Android.

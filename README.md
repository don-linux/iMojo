# iPod

Un iPod en una sola página. La rueda gira con el dedo o el mouse, el menú se mueve como en el aparato, y no hay canciones ni tipografía de terceros.

La pantalla usa la pila del sistema (`system-ui`, Helvetica, Arial). El clic es un tick generado en el momento. La textura de la rueda se dibuja en un canvas.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Cómo se usa

- Arrastra el anillo en círculo. Cada 15° baja o sube una fila. Si giras rápido, salta varias.
- MENU vuelve atrás. El centro elige.
- Playlists, Artists y Songs dicen No Music hasta que conectas Spotify.
- En Settings están About, Shuffle, Repeat, Backlight Timer, Clicker, Reset All Settings y Spotify.
- En About, mantén el centro 5 segundos para abrir Brick. La rueda mueve la paleta.
- Flechas, Enter, espacio y Escape también sirven. Izquierda o Escape vuelven; derecha o Enter eligen.
- Las preferencias se guardan en este navegador.

En claro la pantalla arranca sin luz de fondo. En oscuro queda encendida. Con un temporizador, se enciende al usarla y se apaga sola.

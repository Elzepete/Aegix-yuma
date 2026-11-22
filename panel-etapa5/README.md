# Consola aegix

Panel del operador: actividad en vivo, cola de casos, liberar o confirmar fraude, pulso, señales y latencia.
React + Vite; `proxy.mjs` (solo módulos de Node) sirve la compilación y reenvía a aegix.

```bash
npm ci && npm run build
npm start                 # http://127.0.0.1:4173, aegix en http://127.0.0.1:8081
npm test && npm run lint  # pruebas del servidor y TypeScript
```

| Variable | Para qué |
| --- | --- |
| `YUMA_GO_URL` | dirección de aegix (solo 127.0.0.1); por defecto `http://127.0.0.1:8081` |
| `YUMA_PANEL_TOKEN` | Bearer hacia aegix, si aegix lo exige |
| `YUMA_PANEL_CLAVE` | contraseña de la consola en el navegador; obligatoria si la expones por un túnel |
| `YUMA_PANEL_PORT`, `YUMA_PANEL_HOST` | puerto (4173) y dirección de escucha (127.0.0.1; 0.0.0.0 en Docker) |

`python3 demo.py` arranca el sandbox del reto, aegix y la consola juntos para el botón
«Ejecutar dos transacciones de prueba». Necesita el `mock_api.py` del reto: `YUMA_SANDBOX_PY=ruta/04_Sandbox_API/mock_api.py`.

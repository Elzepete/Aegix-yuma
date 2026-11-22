# Panel local de Escudo Yuma · Etapa 5

Desde esta carpeta, instala las dependencias y compila con una versión compatible de Node y npm.

```sh
npm install
npm run build
python3 demo.py
```

Abre http://127.0.0.1:4173 y pulsa **Ejecutar dos transacciones de prueba**.
Selecciona una fila para ver las razones que devolvió Go. Los indicadores y las
alertas se actualizan al terminar. El arranque también verifica la retención de la operación sintética
`T00001087` con contexto Tor simulado. Verifica la confirmación en Go y comprueba
que el proxy devuelve las mismas alertas e indicadores. Pulsa Ctrl+C para detener
los tres procesos. Si el puerto 4173 está ocupado, elige otro con
`YUMA_PANEL_PORT=4174 python3 demo.py`.

Con Go iniciado por separado, ejecuta `npm start`. El proxy apunta a
`http://127.0.0.1:8081` por defecto. Puedes configurar `YUMA_GO_URL` y, si
Go exige autenticación para el panel, el mismo `YUMA_PANEL_TOKEN` en ambos
procesos. El navegador consulta `/api/alertas` y `/api/indicadores`; Node
reenvía esas consultas a `/alertas` y `/indicadores` de Go.

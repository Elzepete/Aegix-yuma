# Flujo de Escudo Yuma

Versión para GitHub de [presentacion.html](presentacion.html), que además trae los comandos, la lista de verificación
y qué hacer si algo falla.

## Cómo funciona una operación

```mermaid
flowchart TD
  A0(["Cliente entra con su celular y su clave"]) --> A1["Segundo paso: código de 6 dígitos al celular o SMS simulado"]
  A1 --> A(["Pulsa Enviar en la billetera"])
  A --> B{"¿Destino y monto válidos?"}
  B -->|No| B1["Error junto al campo, sin llamar a aegix"]
  B -->|Sí| C["Función de Vercel: agrega IP, país y token"]
  C --> D["Túnel → consola → aegix POST /v1/autorizar"]
  D --> E{"¿Esquema válido y dentro del límite de tasa?"}
  E -->|No| E1["Rechazar con 400 o 429"]
  E -->|Sí| F["Señales: dispositivo, SIM, clave, Tor, destino, historial del cliente"]
  F --> G["Puntaje = suma de pesos, de 0 a 1"]
  G --> H{"Umbrales · recargas y servicios bajan un escalón"}
  H -->|menos de 0,35| AP["Aprobar"]
  H -->|0,35 a 0,65| DE["Desafiar"]
  H -->|0,65 o más con señal ajena al origen| RE["Retener"]
  AP --> AP1["La plata sale: ¡Listo!"]
  DE --> DE1["Código al celular: vale 10 minutos, se puede pedir otro y escuchar"]
  DE1 --> DE2{"¿Código correcto?"}
  DE2 -->|Sí| AP1
  DE2 -->|No, tras 3 intentos| X1["Cancelada: no se mueve plata"]
  RE --> RE1["En revisión: la plata no sale"]
  RE1 --> K["La consola muestra el caso en 2 s o menos, con razones y cómo contactar al cliente"]
  K --> L{"El analista decide"}
  L -->|Liberar| AP2["La billetera se entera en 4 s o menos, descuenta y avisa"]
  L -->|Confirmar fraude| X2["Bloqueada: la plata sigue en la cuenta"]
  AP2 --> M["La resolución queda como etiqueta para recalibrar las reglas"]
  X2 --> M
  classDef ok stroke:#17704A,stroke-width:2px
  classDef alerta stroke:#B07A10,stroke-width:2px
  classDef mal stroke:#C2401F,stroke-width:2px
  class AP,AP1,AP2 ok
  class DE,DE1 alerta
  class RE,RE1,E1,X1,X2 mal
```

## Cómo ejecutarlo al presentar

```mermaid
flowchart TD
  S(["30 minutos antes"]) --> Q1{"¿Internet estable y cuentas de Vercel y ngrok listas?"}
  Q1 -->|Sí| A1["Ruta A · pública: iniciar.sh --tunel --demo-limpia"]
  Q1 -->|No| Q2{"¿Docker instalado?"}
  Q2 -->|Sí| B1["Ruta B · Docker: docker compose up --build"]
  Q2 -->|No| C1["Ruta C · local: iniciar.sh --demo-limpia y la billetera con node"]
  A1 --> V{"¿/salud responde y la consola dice Actualizado ahora?"}
  B1 --> V
  C1 --> V
  V -->|No| F["Revisa Si algo falla o baja a la ruta siguiente"]
  F --> Q2
  V -->|Sí| P["Billetera: Restablecer la demo, Laura con preferencia de contacto"]
  P --> W["Billetera a la izquierda, consola a la derecha"]
  W --> D(["Presentar el guion de 5 minutos"])
  D --> E{"¿Algo se cae en vivo?"}
  E -->|Sí| R["Sigue en la ruta C o pon el video grabado"]
  classDef ruta stroke:#6E73A0,stroke-width:2px
  class A1,B1,C1 ruta
```

| Ruta | Cuándo | Comando |
| --- | --- | --- |
| A · pública | internet, Vercel y ngrok listos | `herramientas/iniciar.sh --tunel --demo-limpia` (con `YUMA_PANEL_TOKEN`, `YUMA_PANEL_CLAVE`, `NGROK_DOMINIO`) |
| B · Docker | sin internet confiable, con Docker | `docker compose up --build` |
| C · local | plan B: Go 1.22+ y Node 20+ | `herramientas/iniciar.sh --demo-limpia` y `AEGIX_URL=http://127.0.0.1:8081 node yuma-billetera/dev.mjs` |

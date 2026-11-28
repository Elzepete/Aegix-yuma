# Cumplimiento, auditoría inmutable y acceso SOC

## Auditoría inmutable: cadena SHA-256 + HMAC

Cada decisión de aegix y cada resolución de un analista se escribe en `datos/decisiones.jsonl`, un archivo al que
solo se le agregan líneas. Cada línea:

- lleva `hash_anterior`: el SHA-256 de la línea anterior, tal como quedó escrita;
- termina en `sello`: un HMAC-SHA256 de la línea, con una clave derivada de la clave de auditoría.

Si alguien borra, cambia, agrega o reordena una línea, la cadena se rompe y se ve en qué línea. Sin la clave
nadie puede volver a sellar una línea alterada. El sello se calcula sobre los bytes exactos, así que se puede
verificar fuera de aegix sin volver a serializar el JSON.

| Dónde | Qué hace |
| --- | --- |
| `internal/registro/cadena.go` | Sella cada línea y verifica la cadena. |
| `GET /auditoria/verificar` | `{integra, lineas, selladas, rupturas[]}`. En la consola: panel «Auditoría y cumplimiento». |
| `GET /auditoria/exportar` | JSON normativo: verificación, método, marco legal y cada línea sellada. Botón «Exportar auditoría (JSON)». |
| `herramientas/centinela.py` | Verifica lo mismo en Python, de forma independiente a aegix. |

Las líneas escritas antes de que existiera el sello se cuentan como «anteriores a la cadena»; la primera línea
sellada queda anclada al hash de la última de ellas.

## Centinela

Adaptado del centinela forense de nuestro compañero de equipo a la auditoría real de aegix. Corre aparte (en su
propio contenedor o desde `iniciar.sh`), lee la auditoría en solo lectura y no suma latencia a ninguna decisión.

1. **Cadena de custodia:** verifica la cadena en cada ciclo. Si se rompe, escribe `ALERTA_CADENA_*.json` y avisa
   al celular por ntfy.
2. **Expedientes forenses:** por cada operación retenida escribe `expediente-<referencia>.md` con la decisión, las
   razones, las señales, el canal de contacto, quién la resolvió y los datos de custodia (línea, SHA-256 y sello).
3. **Oleadas:** compara la mezcla de puntajes de las últimas 200 decisiones con la de referencia (PSI). Más de 0,25
   es un cambio fuerte, una posible campaña de fraude; entre 0,10 y 0,25, una advertencia.

```bash
python3 herramientas/centinela.py --una-vez            # verifica, escribe expedientes y sale
python3 herramientas/centinela.py --verificar-cadena   # código 1 si la cadena está rota
```

## Acceso SOC a la consola: contraseña scrypt + TOTP de 6 dígitos

| Rol | Ver casos y actividad | Resolver casos | Verificar y exportar auditoría | Prueba de transacciones |
| --- | :---: | :---: | :---: | :---: |
| `admin` | ✔ | ✔ | ✔ | ✔ |
| `analista` | ✔ | ✔ | ✔ | |
| `auditor` | ✔ | | ✔ | |
| `empleado` | ✔ | | | |

- Contraseña guardada con **scrypt** (N = 2¹⁵, r = 8, p = 1, sal aleatoria); nunca en claro.
- Segundo factor **TOTP** (RFC 6238, 6 dígitos, 30 s), compatible con Google Authenticator, Aegis o Authy. Un
  código no sirve dos veces.
- Máximo 5 intentos fallidos por usuario y 20 por IP cada 15 minutos.
- Sesión en una cookie firmada con HMAC, `HttpOnly` y `SameSite=Strict`, que vence a las 8 horas.
- Los permisos se aplican en el servidor (`proxy.mjs`), no solo en la pantalla.
- Cada resolución guarda quién la hizo (`analista: "ana (analista)"`) dentro de la línea sellada.

Crear usuarios (el archivo vive en `datos/`, que Git ignora):

```bash
node panel-etapa5/usuarios.mjs agregar ana analista datos/acceso/usuarios.json
node panel-etapa5/usuarios.mjs agregar luis auditor datos/acceso/usuarios.json
```

El comando imprime la contraseña y el secreto TOTP. En la app autenticadora elige «Ingresar clave de
configuración» y escribe el secreto. `iniciar.sh` usa el archivo automáticamente; con `--sin-clave` la consola
queda abierta para una demostración. Con Docker: `YUMA_USUARIOS_DOCKER=/app/acceso/usuarios.json docker compose up`.

## Logs

Todos los servicios escriben una línea JSON por evento, sin datos personales de los clientes: ni IP, ni huella del
dispositivo, ni identificadores en claro (las referencias son el seudónimo HMAC recortado).

| Log | Dónde | Qué registra |
| --- | --- | --- |
| Bitácora de seguridad de la consola | `datos/accesos.jsonl` (con `iniciar.sh`), salida estándar y panel «Bitácora de accesos» (con descarga en JSON) | Ingresos (rol, permisos, vencimiento de la sesión), intentos fallidos con el factor que falló, bloqueos, sesiones vencidas o alteradas, accesos denegados (método, ruta y permiso), resoluciones (acción, estado final del caso y duración), exportaciones y descargas. Cada **operación de la billetera que cruza el túnel**: decisión, puntaje, razones, latencia de aegix y total, y si vino por el túnel. Cada evento lleva IP, navegador e identificador corto de la sesión del empleado. Cadena SHA-256 entre líneas; nunca guarda contraseñas ni códigos. |
| aegix (`log/slog`) | Salida estándar | `aegix_iniciado` (reglas, umbrales, límites, protecciones activas); cada **decisión de la billetera** con nivel de riesgo, razones, operación (tipo, canal, monto, monto sobre saldo, tipo de destino, antigüedad), señales (dispositivo, destino, SIM, clave, departamento, Tor, proxy, país), versión de la app y contacto accesible; `rechazo` con el motivo; `contingencia` (tiempo agotado u origen caído); `resolucion` con el analista; `reglas_recargadas`; `auditoria_alterada`; y un `resumen_minuto` con totales, TPS, latencia p50/p99, cumplimiento del SLA y monto protegido. |
| Centinela | Salida estándar y `datos/expedientes/ALERTA_*.json` | `verificacion` cada vez que cambia la auditoría (cadena, decisiones por tipo, retenidas, pendientes, fraudes confirmados, liberadas, PSI), expedientes escritos, cadena rota y oleadas. |
| Auditoría de decisiones | `datos/decisiones.jsonl` | La evidencia sellada (arriba). |

En Docker: `docker compose logs -f consola aegix centinela`. Cada servicio rota sus logs a los 10 MB (5 archivos).

## Contenedores

`docker compose up --build` levanta aegix, la consola, la billetera y el centinela. Todos corren con un usuario
sin privilegios, sistema de archivos de solo lectura (`read_only`), sin capacidades de Linux (`cap_drop: ALL`) y
con `no-new-privileges`. aegix no publica su puerto; el centinela monta la auditoría en solo lectura.

## Normativa colombiana

| Norma | Cómo la atiende Escudo Yuma | Alcance |
| --- | --- | --- |
| **Ley 1581 de 2012** (protección de datos personales) | La auditoría no guarda nombres ni celulares en claro: los identificadores son seudónimos HMAC. Ninguna regla usa edad, región ni ingresos. Las preferencias de accesibilidad solo informan cómo contactar y nunca entran al puntaje (hay una prueba que lo garantiza). Se guardan preferencias de comunicación, nunca datos de salud. | Alineado con los principios de finalidad, necesidad y seguridad. |
| **SARLAFT** (Superintendencia Financiera) | Toda operación retenida la resuelve una persona; queda en la auditoría sellada quién la resolvió y cuándo. Cada decisión se explica con sus razones. La auditoría es exportable para una revisión. | Apoya la revisión humana y la trazabilidad; no reemplaza el sistema SARLAFT de la entidad. |
| **PCI DSS** | aegix no recibe, procesa ni guarda números de tarjeta. | Fuera de alcance. |

Esto es una simulación para una hackatón: describe cómo el diseño se alinea con estas normas, no una
certificación de cumplimiento.
